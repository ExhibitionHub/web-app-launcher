export const EXPERIENCE = {
  POST_MASTER: 'post_master',
  PERMICIEN: 'permicien'
};

export function isValidExperience(value) {
  return value === EXPERIENCE.POST_MASTER || value === EXPERIENCE.PERMICIEN;
}

export function applyExperienceToDocument(value) {
  if (!isValidExperience(value)) return;
  document.documentElement.dataset.experience = value;
}

export function filterWondersByExperience(wonders, experience) {
  const list = Array.isArray(wonders) ? wonders : [];
  if (!isValidExperience(experience)) return list;

  return list.filter(w => {
    const v = w && (w.experience || w.experienceId || w.mode);
    if (!v) return true; // if not specified, show in both experiences

    if (Array.isArray(v)) {
      return v.map(x => String(x).toLowerCase()).includes(experience);
    }
    return String(v).toLowerCase() === experience;
  });
}
