// Reads and saves the hub data in the GitHub repo, straight from the browser, with the editor's own
// GitHub token. One save is one atomic commit (createCommitOnBranch), so the data files and the
// generated app manifests can never get out of step.
//
// Only the files that changed are written, so two people editing different cards never collide.

import {
  appManifestPath,
  buildAppManifest,
  canonicalizeManifest,
  formatJson,
  isPlainObject,
  parseAppMeta,
  parseLocalAppUrl,
  validateEntry,
  validateFamilies,
} from './hub-rules.js';

const GRAPHQL_URL = 'https://api.github.com/graphql';
const FAMILIES_PATH = 'data/families.json';
const CARDS_DIR = 'data/cards';
const WRITE_PERMISSIONS = new Set(['WRITE', 'MAINTAIN', 'ADMIN']);

export class StoreError extends Error {
  constructor(message, { kind = 'error', errors = [] } = {}) {
    super(message);
    this.kind = kind; // 'auth' | 'permission' | 'validation' | 'conflict' | 'error'
    this.errors = errors;
  }
}

const cardPath = (id) => `${CARDS_DIR}/${id}.json`;
const encodeBase64 = (value) => btoa(unescape(encodeURIComponent(value)));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function parseJson(textValue, path) {
  try {
    return JSON.parse(textValue);
  } catch (error) {
    throw new StoreError(`${path} on GitHub is not valid JSON: ${error.message}`);
  }
}

// What changed between two manifests: card ids added / changed / removed, and whether the families changed.
export function diffManifests(base, next) {
  const baseById = new Map(base.entries.map((entry) => [entry.id, entry]));
  const nextById = new Map(next.entries.map((entry) => [entry.id, entry]));

  return {
    added: next.entries.filter((entry) => !baseById.has(entry.id)),
    changed: next.entries.filter((entry) => baseById.has(entry.id) && !same(baseById.get(entry.id), entry)),
    removed: base.entries.filter((entry) => !nextById.has(entry.id)),
    familiesChanged: !same(base.families, next.families),
  };
}

function describeChange(diff) {
  const cards = [...diff.added, ...diff.changed, ...diff.removed];
  if (cards.length === 1) {
    const verb = diff.added.length ? 'add' : diff.removed.length ? 'delete' : 'update';
    return `Hub: ${verb} ${cards[0].title}`;
  }
  if (cards.length > 1) {
    return `Hub: update ${cards.length} cards`;
  }
  return 'Hub: update families';
}

export function createGithubStore({ token, repo, fetchImpl = (...args) => fetch(...args) }) {
  const repositoryName = `${repo.owner}/${repo.name}`;
  let snapshot = null;

  async function graphql(query, variables = {}) {
    let response;
    try {
      response = await fetchImpl(GRAPHQL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new StoreError('Could not reach GitHub. Check your internet connection.');
    }

    if (response.status === 401) {
      throw new StoreError('GitHub did not accept the token. It may be wrong, expired or revoked.', { kind: 'auth' });
    }

    const body = await response.json().catch(() => null);
    if (!body || (!response.ok && !body.errors)) {
      throw new StoreError(`GitHub answered with an error or an unreadable reply (HTTP ${response.status}).`);
    }

    if (body?.errors?.length) {
      const failure = new StoreError(body.errors.map((error) => error.message).join(' '));
      failure.graphqlErrors = body.errors;
      throw failure;
    }

    return body.data;
  }

  const isStaleHead = (error) => (error.graphqlErrors || []).some((item) => item.type === 'STALE_DATA' || /Expected branch to point to/i.test(item.message));

  async function loadSource() {
    const data = await graphql(`query LoadSource($owner: String!, $name: String!, $branch: String!, $cards: String!, $families: String!) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        viewerPermission
        ref(qualifiedName: $branch) { target { oid } }
        cards: object(expression: $cards) { ... on Tree { entries { name oid object { ... on Blob { text } } } } }
        families: object(expression: $families) { ... on Blob { oid text } }
      }
    }`, {
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch,
      cards: `${repo.branch}:${CARDS_DIR}`,
      families: `${repo.branch}:${FAMILIES_PATH}`,
    });

    const repository = data.repository;
    if (!repository) {
      throw new StoreError(`The token cannot see ${repositoryName}. Give the token access to this repository.`, { kind: 'permission' });
    }
    if (!WRITE_PERMISSIONS.has(repository.viewerPermission)) {
      throw new StoreError(`${data.viewer.login} can only read ${repositoryName}. The token needs "Contents: Read and write".`, { kind: 'permission' });
    }
    if (!repository.ref) {
      throw new StoreError(`The branch "${repo.branch}" does not exist in ${repositoryName}.`);
    }

    const oids = new Map();
    const entries = (repository.cards?.entries || [])
      .filter((entry) => entry.name.endsWith('.json'))
      .map((entry) => {
        const path = `${CARDS_DIR}/${entry.name}`;
        oids.set(path, entry.oid);
        return parseJson(entry.object?.text ?? 'null', path);
      });
    const families = repository.families ? parseJson(repository.families.text, FAMILIES_PATH) : [];
    if (repository.families) {
      oids.set(FAMILIES_PATH, repository.families.oid);
    }

    snapshot = {
      login: data.viewer.login,
      head: repository.ref.target.oid,
      oids,
      manifest: canonicalizeManifest({ families: Array.isArray(families) ? families : [], entries }),
    };
    return snapshot;
  }

  // For files that cannot be checked in the browser: asks whether paths exist at the branch head.
  async function pathOids(paths) {
    if (!paths.length) {
      return new Map();
    }

    const fields = paths.map((path, index) => `p${index}: object(expression: ${JSON.stringify(`${repo.branch}:${path}`)}) { oid }`).join('\n');
    const data = await graphql(`query PathOids($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { ${fields} }
    }`, { owner: repo.owner, name: repo.name });

    return new Map(paths.map((path, index) => [path, data.repository[`p${index}`]?.oid || null]));
  }

  async function getAppInfo(local) {
    const base = `${repo.branch}:apps/${local.family}/${local.key}`;
    const data = await graphql(`query AppInfo($owner: String!, $name: String!, $index: String!, $lang: String!) {
      repository(owner: $owner, name: $name) {
        index: object(expression: $index) { ... on Blob { text } }
        lang: object(expression: $lang) { ... on Tree { entries { name } } }
      }
    }`, { owner: repo.owner, name: repo.name, index: `${base}/index.html`, lang: `${base}/lang` });

    const markup = data.repository.index?.text;
    if (typeof markup !== 'string') {
      return null;
    }
    return { meta: parseAppMeta(markup), langFiles: data.repository.lang ? data.repository.lang.entries.map((entry) => entry.name) : null };
  }

  async function validateChanges(next, diff) {
    const { errors, familyIds } = validateFamilies(next.families);

    const seen = new Map();
    next.entries.forEach((entry) => {
      const key = String(entry.id).toLowerCase();
      seen.set(key, (seen.get(key) || 0) + 1);
    });

    for (const entry of [...diff.added, ...diff.changed]) {
      const takenIds = new Set([...seen.keys()].filter((key) => key !== String(entry.id).toLowerCase() || seen.get(key) > 1));
      errors.push(...await validateEntry(entry, `"${entry.title || entry.id}"`, { familyIds, takenIds, getAppInfo }));
    }

    next.entries.filter((entry) => !familyIds.has(entry.family) && !diff.added.includes(entry) && !diff.changed.includes(entry))
      .forEach((entry) => errors.push(`"${entry.title}" belongs to a family that no longer exists`));

    if (errors.length) {
      throw new StoreError(errors.join('\n'), { kind: 'validation', errors });
    }
  }

  // Everything one save writes: the changed card files, the families file, and the generated app manifests.
  async function buildFileChanges(base, next, diff) {
    const additions = [];
    const deletions = [];
    const add = (path, value) => additions.push({ path, contents: encodeBase64(formatJson(value)) });

    [...diff.added, ...diff.changed].forEach((entry) => add(cardPath(entry.id), entry));
    diff.removed.forEach((entry) => deletions.push({ path: cardPath(entry.id) }));
    if (diff.familiesChanged) {
      add(FAMILIES_PATH, next.families);
    }

    [...diff.added, ...diff.changed].forEach((entry) => {
      const local = entry.type === 'launch' ? parseLocalAppUrl(entry.url) : null;
      if (local) {
        add(appManifestPath(local), buildAppManifest(entry, local));
      }
    });

    // A removed card, or one that no longer points at a local app, leaves its generated manifest behind.
    const keptPaths = new Set(additions.map((item) => item.path));
    const orphanCandidates = [...diff.removed, ...diff.changed]
      .map((entry) => base.entries.find((old) => old.id === entry.id))
      .filter((old) => old && old.type === 'launch' && parseLocalAppUrl(old.url))
      .map((old) => appManifestPath(parseLocalAppUrl(old.url)))
      .filter((path) => !keptPaths.has(path));
    const existing = await pathOids([...new Set(orphanCandidates)]);
    existing.forEach((oid, path) => {
      if (oid) {
        deletions.push({ path });
      }
    });

    return { additions, deletions };
  }

  async function createCommit(fileChanges, message, expectedHeadOid) {
    const data = await graphql(`mutation Commit($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`, {
      input: {
        branch: { repositoryNameWithOwner: repositoryName, branchName: repo.branch },
        message: { headline: message },
        expectedHeadOid,
        fileChanges,
      },
    });
    return data.createCommitOnBranch.commit.oid;
  }

  async function save(draft) {
    if (!snapshot) {
      throw new StoreError('Load the data first.');
    }

    const base = snapshot;
    const next = canonicalizeManifest(draft);
    if (!isPlainObject(next)) {
      throw new StoreError('The data is not valid.', { kind: 'validation' });
    }

    const diff = diffManifests(base.manifest, next);
    if (![diff.added, diff.changed, diff.removed].some((list) => list.length) && !diff.familiesChanged) {
      return snapshot;
    }

    await validateChanges(next, diff);
    const fileChanges = await buildFileChanges(base.manifest, next, diff);
    const message = describeChange(diff);
    const touched = [...fileChanges.additions, ...fileChanges.deletions].map((item) => item.path);

    try {
      await createCommit(fileChanges, message, base.head);
    } catch (error) {
      if (!isStaleHead(error)) {
        throw error;
      }

      // Someone else saved meanwhile. Retry on the new head only if they did not touch the data files we change.
      // (The generated app manifests follow their card, so a clash there is a clash on the card itself.)
      const latest = await loadSource();
      const dataPaths = touched.filter((path) => path.startsWith(`${CARDS_DIR}/`) || path === FAMILIES_PATH);
      if (dataPaths.some((path) => (latest.oids.get(path) || null) !== (base.oids.get(path) || null))) {
        throw new StoreError('Someone else changed the same card or family while you were editing. Your change was not saved. The latest data is loaded: redo your change.', { kind: 'conflict' });
      }

      await createCommit(fileChanges, message, latest.head);
    }

    return loadSource();
  }

  return {
    loadSource,
    save,
    get login() {
      return snapshot?.login || '';
    },
    get manifest() {
      return snapshot?.manifest || null;
    },
  };
}
