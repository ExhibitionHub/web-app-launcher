export class WantedPoster {
    constructor(config = {}) {
        const { assetsBasePath = 'ressource/research', lang = {}, ...restConfig } = config || {};
        this.assetsBasePath = assetsBasePath;
        this.lang = lang || {};
        // Generate random IDs for "Global Numbers"
        const rand = (len) => Math.floor(Math.random() * Math.pow(10, len)).toString().padStart(len, '0');
        const randChar = () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
        this.defaultChargesMap = {
            "THE STRATEGIST": [
                { charge: "STRUCTURED PLANS", term: "CORE" },
                { charge: "CALM DECISIONS", term: "HIGH" },
                { charge: "BACKUP PATHS", term: "READY" },
                { charge: "DETAIL TRACKER", term: "SOLID" },
                { charge: "CLEAR SIGNALS", term: "STRONG" }
            ],
            "THE SPONTANEOUS": [
                { charge: "INSTANT REACT", term: "GO" },
                { charge: "EMOTION-LED", term: "HIGH" },
                { charge: "LOVES CHANGE", term: "MAX" },
                { charge: "FLEXIBLE PLAN", term: "LIGHT" },
                { charge: "CREATIVE SPARK", term: "BRIGHT" }
            ],
            "THE EXPERIENCE SEEKER": [
                { charge: "SEEKS NOVELTY", term: "BOLD" },
                { charge: "PLAYFUL RISK", term: "SPICE" },
                { charge: "STORY MAKER", term: "LIVE" },
                { charge: "MIXES PLAN/PLAY", term: "HYBRID" },
                { charge: "SENSORY FOCUS", term: "HIGH" }
            ],
            "THE DIRECTOR": [
                { charge: "SETS DIRECTION", term: "LEAD" },
                { charge: "COORDINATES TEAM", term: "SYNC" },
                { charge: "DECISIVE CALLS", term: "FAST" },
                { charge: "KEEPS OVERVIEW", term: "CLEAR" },
                { charge: "HOLDS ACCOUNTABLE", term: "STEADY" }
            ],
            "THE PURPOSEFUL IDEALIST": [
                { charge: "MISSION FIRST", term: "CORE" },
                { charge: "VALUES-DRIVEN", term: "ANCHOR" },
                { charge: "LONG VIEW", term: "FAR" },
                { charge: "CAUSE BUILDER", term: "BUILD" },
                { charge: "INSPIRES OTHERS", term: "LIFT" }
            ],
            "THE BALANCED INDIVIDUAL": [
                { charge: "STEADY MOOD", term: "CALM" },
                { charge: "EMPATHETIC", term: "WARM" },
                { charge: "BALANCED RESPONSE", term: "LEVEL" },
                { charge: "HEALTHY BOUNDARIES", term: "CLEAR" },
                { charge: "CENTERED ENERGY", term: "STEADY" }
            ],
            "DEFAULT": [
                { charge: "SESSION NOTE", term: "PENDING" }
            ]
        };

        this.otherInfoFallback = [
            "* Profile in construction",
            "waiting for camera snapshot.",
            "Session notes will refresh",
            "after your responses.",
            "Designed for self-reflection.",
            "Share or download when ready."
        ];
        
        this.config = {
            header: "INVESTIGATION DEPARTMENT",
            subHeader: "REFLECTION DOSSIER",
            fileNumber: "#" + rand(7) + "-" + rand(3),
            purposeCode: "R-" + rand(6) + "-0(S)",
            sruId: "R" + rand(3),
            handwrittenCode: "RT" + rand(6),
            // Personal data is indeterminable for a kiosk user -> Redacted/Unknown
            name: "[REDACTED]",
            aliases: "[REDACTED]",
            recordId: "Q" + rand(4) + randChar() + rand(5),
            nationality: "SELF",
            citizen: "IN PROGRESS",
            gender: "[SELF-REPORTED]",
            race: "BALANCED",
            height: "UPRIGHT",
            weight: "STEADY",
            eyeColor: "[REDACTED]",
            hairColor: "[REDACTED]",
            dob: "[REDACTED]",
            age: "CURRENT",
            // Default arrests (will be overwritten if profile is set)
            arrests: [
                { date: rand(1)+"-"+rand(3), institution: "SESSION", charge: "Awaiting responses", term: "N/A" }
            ],
            ...restConfig
        };
        
        // Load texture image
        this.paperTextureImg = new Image();
        this.paperTextureImg.src = `${this.assetsBasePath}/textures/PaperTexture.png`;

        // Load stamp image
        this.stampImg = new Image();
        this.stampImg.src = `${this.assetsBasePath}/textures/Tampon.png`;

        // Load logo image (top-left)
        this.logoImg = new Image();
        this.logoImg.src = `${this.assetsBasePath}/textures/Logo.png`;
        // Load exhibition logo (bottom-left)
        this.exhibitionLogoImg = new Image();
        this.exhibitionLogoImg.src = `${this.assetsBasePath}/ExhibitionLogo.png`;

        // Initialize layout randomization
        this.layout = this.generateLayout();
        this.chargesMap = this.defaultChargesMap;
        this.applyLang(this.lang);
    }

    t(path, fallback = '') {
        if (!this.lang) return fallback;
        const parts = path.split('.');
        let node = this.lang;
        for (const p of parts) {
            if (!node || typeof node !== 'object') return fallback;
            node = node[p];
        }
        return node ?? fallback;
    }

    setLang(langData = {}) {
        this.lang = langData || {};
        this.applyLang(this.lang);
    }

    applyLang(langData = {}) {
        this.lang = langData || {};
        const defaults = this.lang.defaults || {};
        const rand = (len) => Math.floor(Math.random() * Math.pow(10, len)).toString().padStart(len, '0');
        const randChar = () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];

        // Override header + subheader
        this.config.header = this.lang.header || this.config.header;
        this.config.subHeader = this.lang.subHeader || this.config.subHeader;

        // Default placeholders
        const defaultKeys = ['name','aliases','nationality','citizen','gender','race','height','weight','eyeColor','hairColor','dob','age'];
        defaultKeys.forEach(key => {
            if (defaults[key]) {
                this.config[key] = defaults[key];
            }
        });

        if (Array.isArray(defaults.arrests) && defaults.arrests.length) {
            this.config.arrests = defaults.arrests.map(a => ({
                date: rand(1)+"-"+rand(3),
                institution: a.institution,
                charge: a.charge,
                term: a.term
            }));
        }

        this.defaultRedaction = defaults.defaultRedaction || this.config.aliases;
        this.defaultUnknown = defaults.defaultUnknown || 'UNKNOWN';
        this.otherInfoFallback = this.lang.otherInfoFallback || this.otherInfoFallback;
        this.chargesMap = this.lang.charges || this.defaultChargesMap;
    }

    generateLayout() {
        const rand = (min, max) => Math.random() * (max - min) + min;
        return {
            photo: {
                xOffset: rand(-20, 20),
                yOffset: rand(-20, 20),
                rotation: rand(-0.05, 0.05)
            },
            stamp: {
                xOffset: rand(-30, 30),
                yOffset: rand(-30, 30),
                rotation: rand(-0.5, 0.5)
            },
            paperclip: {
                xOffset: rand(-10, 10),
                rotation: rand(0.1, 0.4)
            },
            handwrittenNote: {
                xOffset: rand(-10, 10),
                yOffset: rand(-5, 5),
                rotation: rand(-0.1, 0.05)
            },
            redactionSeed: Math.random() * 10000,
            arrestRedactionSeeds: Array.from({length: 10}, () => Math.random() * 10000),
            personalInfoRedactionSeeds: {
                "NAME": Math.random() * 10000,
                "ALIASES": Math.random() * 10000,
                "GENDER": Math.random() * 10000,
                "RACE/ETHNICITY": Math.random() * 10000,
                "HEIGHT": Math.random() * 10000,
                "WEIGHT": Math.random() * 10000,
                "EYE COLOR": Math.random() * 10000,
                "HAIR COLOR": Math.random() * 10000,
                "DOB": Math.random() * 10000
            }
        };
    }

    // Helper for seeded random numbers
    seededRandom(seed) {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }

    // Method to regenerate random global data (File numbers, etc.)
    regenerateGlobalData() {
        const rand = (len) => Math.floor(Math.random() * Math.pow(10, len)).toString().padStart(len, '0');
        const randChar = () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];

        this.config.fileNumber = "#" + rand(7) + "-" + rand(3);
        this.config.purposeCode = "R-" + rand(6) + "-0(S)";
        this.config.sruId = "R" + rand(3);
        this.config.handwrittenCode = "RT" + rand(6);
        this.config.recordId = "Q" + rand(4) + randChar() + rand(5);
        
        // Regenerate layout positions
        this.layout = this.generateLayout();
    }

    // Method to set data based on Quiz Profile
    setProfile(profile) {
        if (!profile) return;

        const profileKey = profile?.id || profile?.type;
        const profileLabel = profile?.label || profile?.type || '';

        const charges = this.chargesMap[profileKey] || this.chargesMap.DEFAULT || [
            { charge: "UNKNOWN OFFENSE", term: "INDEFINITE" }
        ];

        // Pick between 1 and 5 charges (or max available) at random without replacement
        const pool = [...charges];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const selectionCount = Math.max(1, Math.min(pool.length, Math.floor(Math.random() * 5) + 1));
        const selectedCharges = pool.slice(0, selectionCount);

        // Generate arrest records based on selected charges
        const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
        this.config.arrests = selectedCharges.map(c => ({
            date: rand(1, 12) + "-" + rand(100, 999),
            institution: ["BELLE REVE", "ARKHAM", "BLACKGATE", "IRON HEIGHTS", "BELLE REVE"][rand(0, 4)],
            charge: c.charge,
            term: c.term
        }));

        const notesLang = this.lang.notes || {};
        const divider = notesLang.divider || "--------------------------------";
        const subjectTemplate = notesLang.subjectProfile || "SUBJECT PROFILE: {type}";
        const psychTemplate = notesLang.psychEval || "PSYCH EVAL: {control} CONTROL";
        const controlLabel =
            profile?.traitSummary?.control ||
            profile?.traits?.control ||
            profile?.traits?.["Need for Control"] ||
            profile?.traits?.["Kontrollbedürfnis"] ||
            this.defaultUnknown ||
            "UNKNOWN";

        // Update "Other Info" with profile characteristics
        this.config.notes = [
            subjectTemplate.replace('{type}', profileLabel),
            divider,
            ...profile.characteristics.slice(0, 4).map(c => "- " + c),
            divider,
            psychTemplate.replace('{control}', controlLabel)
        ];
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    draw(ctx, width, height, imageSource) {
        let photoPlacement = null;
        const labels = this.lang?.labels || {};
        const label = (key, fallback) => labels[key] || fallback;
        const sealCode = this.lang.sealCode || "UFPD07OFF002274";
        const intended = this.lang.intended || "Intended for official use only.";
        const separatorCode = this.lang.separatorCode || "P034";
        const stampText = label('stampFiled', 'FILED');
        // 1. Background (Beige Paper)
        ctx.fillStyle = "#f0e6d2"; 
        ctx.fillRect(0, 0, width, height);

        // Apply Paper Texture
        this.drawPaperTexture(ctx, width, height);

        const margin = width * 0.05;
        const contentWidth = width - (margin * 2);
        
        // 2. Header Section
        let currentY = height * 0.04; // Reduced from 0.05
        
        // Logo (Top Left)
        const logoRadius = width * 0.09;
        const logoSize = logoRadius * 2;
        if (this.logoImg.complete && this.logoImg.naturalWidth !== 0) {
            ctx.drawImage(this.logoImg, margin, currentY, logoSize, logoSize);
        } else {
            this.drawSeal(ctx, margin + logoRadius, currentY + logoRadius, logoRadius);
        }
        
        // Title (Top Center-ish) with 2-line wrap if too long
        ctx.fillStyle = "#1a1a1a";
        ctx.textAlign = "left";
        const headerX = margin + (logoRadius * 2.5);
        const headerFontSize = width * 0.032;
        ctx.font = "bold " + headerFontSize + "px 'Courier New'";
        const headerLineHeight = headerFontSize * 1.1;
        const headerMaxWidth = Math.max(width * 0.3, (width * 0.60) - headerX - (width * 0.02));
        const headerLines = this.wrapText(ctx, this.config.header, headerMaxWidth, 2);
        const headerBaseY = currentY + logoRadius * 0.8;
        headerLines.forEach((line, idx) => {
            ctx.fillText(line, headerX, headerBaseY + (idx * headerLineHeight));
        });
        const headerBlockBottom = headerBaseY + (headerLines.length * headerLineHeight);
        
        ctx.font = "bold " + (width * 0.018) + "px 'Courier New'";
        const sealY = headerBlockBottom + (width * 0.012);
        ctx.fillText(sealCode, headerX, sealY);

        // Intended text (Moved to left side to avoid photo and balance header)
        ctx.font = (width * 0.014) + "px 'Courier New'";
        const intendedY = sealY + (width * 0.028);
        ctx.fillText(intended, headerX, intendedY);

        // File Info (Top Right)
        // Moved right to avoid collision with large logo/title
        const fileInfoX = width * 0.60; 
        const fileInfoY = currentY;
        const lineHeight = width * 0.035;
        
        ctx.font = "bold " + (width * 0.022) + "px 'Courier New'";
        
        // Draw lines for file info
        this.drawLineField(ctx, label('fileNumber', "FILE NUMBER"), this.config.fileNumber, fileInfoX, fileInfoY, width - margin - fileInfoX, lineHeight);
        this.drawLineField(ctx, label('purposeCode', "PURPOSE CODE"), this.config.purposeCode, fileInfoX, fileInfoY + lineHeight * 1.5, width - margin - fileInfoX, lineHeight);
        this.drawLineField(ctx, label('sruId', "SRU ID"), this.config.sruId, fileInfoX, fileInfoY + lineHeight * 3, width - margin - fileInfoX, lineHeight);
        
        // Separator
        ctx.textAlign = "right";
        ctx.fillText(separatorCode, width - margin, fileInfoY + lineHeight * 4.5);

        // Separator
        const headerAreaBottom = intendedY + (width * 0.015);
        currentY = Math.max(currentY + (logoRadius * 2.2), fileInfoY + lineHeight * 5, headerAreaBottom);
        ctx.beginPath();
        ctx.moveTo(margin, currentY);
        ctx.lineTo(width - margin, currentY);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3. Personal Info Grid
        currentY += (height * 0.015); // Reduced from 0.02
        const col1X = margin;
        const col2X = width * 0.5;
        const rowHeight = height * 0.03; // Reduced from 0.035
        
        // Name & Aliases
        this.drawField(ctx, label('name', "NAME"), this.config.name, col1X, currentY, width * 0.45);
        currentY += rowHeight;
        this.drawField(ctx, label('aliases', "ALIASES"), this.config.aliases, col1X, currentY, width * 0.45);
        currentY += rowHeight;
        
        // Record ID Box
        currentY += rowHeight * 0.5;
        this.drawRecordIdBox(ctx, this.config.recordId, col1X, currentY, width * 0.45, rowHeight, label('recordId', 'RECORD ID#'));
        currentY += rowHeight * 1.5;

        // Details Grid
        this.drawField(ctx, label('nationality', "NATIONALITY"), this.config.nationality, col1X, currentY, width * 0.25);
        this.drawField(ctx, label('citizen', "CITIZEN"), this.config.citizen, col2X, currentY, width * 0.2);
        currentY += rowHeight;
        
        this.drawField(ctx, label('gender', "GENDER"), this.config.gender, col1X, currentY, width * 0.25);
        this.drawField(ctx, label('race', "RACE/ETHNICITY"), this.config.race, col2X, currentY, width * 0.25); // Multi-line label fix needed?
        currentY += rowHeight;

        this.drawField(ctx, label('height', "HEIGHT"), this.config.height, col1X, currentY, width * 0.25);
        this.drawField(ctx, label('weight', "WEIGHT"), this.config.weight, col2X, currentY, width * 0.2);
        currentY += rowHeight;

        this.drawField(ctx, label('eyeColor', "EYE COLOR"), this.config.eyeColor, col1X, currentY, width * 0.25);
        this.drawField(ctx, label('hairColor', "HAIR COLOR"), this.config.hairColor, col2X, currentY, width * 0.2);
        currentY += rowHeight;

        this.drawField(ctx, label('dob', "DOB"), this.config.dob, col1X, currentY, width * 0.25);
        this.drawField(ctx, label('age', "AGE"), this.config.age, col2X, currentY, width * 0.2);
        
        // Handwritten note
        ctx.save();
        // Random position near personal info but not covering it
        const noteX = col2X + (width * 0.15) + this.layout.handwrittenNote.xOffset;
        const noteY = currentY - rowHeight * 0.5 + this.layout.handwrittenNote.yOffset;
        
        ctx.translate(noteX, noteY);
        ctx.rotate(this.layout.handwrittenNote.rotation);
        ctx.font = "italic " + (width * 0.03) + "px 'Segoe Script', cursive";
        ctx.fillStyle = "#555";
        ctx.fillText(this.config.handwrittenCode, 0, 0);
        ctx.restore();
        
        currentY += rowHeight * 1.2; // Reduced from 1.5

        // 4. Arrest & Sentencing Info
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "bold " + (width * 0.025) + "px 'Courier New'";
        ctx.fillText(label('arrestSection', "ARREST & SENTENCING INFO"), margin, currentY);
        
        currentY += (height * 0.01);
        // Table Header
        ctx.beginPath();
        ctx.moveTo(margin, currentY);
        ctx.lineTo(width - margin, currentY);
        ctx.stroke();
        
        currentY += (height * 0.02);
        const tableY = currentY;
        const colDate = margin;
        const colCode = margin + (width * 0.12);
        const colInst = margin + (width * 0.28);
        const colCharge = margin + (width * 0.58);
        const colTerm = margin + (width * 0.86);
        
        ctx.font = "bold " + (width * 0.018) + "px 'Courier New'";
        ctx.fillText(label('date', "DATE"), colDate, currentY);
        ctx.fillText(label('offenseCode', "OFFENSE CODE"), colCode, currentY);
        ctx.fillText(label('institution', "INSTITUTION"), colInst, currentY);
        ctx.fillText(label('charge', "CHARGE AND DESCRIPTION"), colCharge, currentY);
        ctx.fillText(label('term', "TERM"), colTerm, currentY);
        
        currentY += (height * 0.01);
        ctx.beginPath();
        ctx.moveTo(margin, currentY);
        ctx.lineTo(width - margin, currentY);
        ctx.stroke();
        
        // Table Rows
        // Dynamic sizing to fit many arrests
        const maxTableHeight = height * 0.22; // Reduced from 0.25
        const arrests = (this.config.arrests || []).slice(0, 5); // Limit to 5
        const rowCount = arrests.length;
        
        // Calculate row height based on count, but clamp between min and max values
        let tableRowHeight = height * 0.035;
        let fontSize = width * 0.018;
        
        if (rowCount > 5) {
            tableRowHeight = maxTableHeight / rowCount;
            // Scale font size with row height
            fontSize = tableRowHeight * 0.55;
        }

        currentY += (tableRowHeight * 0.7); // Initial offset
        ctx.font = fontSize + "px 'Courier New'";
        
        arrests.forEach((arrest, index) => {
            // Redacted Date (Worn Black Bar)
            ctx.save();
            const rx = margin;
            const ry = currentY - (fontSize * 0.8);
            const rw = width * 0.08;
            const rh = fontSize * 1.2;
            
            ctx.fillStyle = "#1a1a1a";
            let seed = this.layout.arrestRedactionSeeds[index] || index * 100;
            
            for(let i=0; i<5; i++) {
                 const r1 = this.seededRandom(seed++);
                 const r2 = this.seededRandom(seed++);
                 const r3 = this.seededRandom(seed++);
                 
                 const oy = (r1 - 0.5) * (rh * 0.3);
                 const lw = rw + (r2 - 0.5) * (rw * 0.1);
                 const lh = rh * (0.6 + r3 * 0.4);
                 ctx.globalAlpha = 0.8;
                 ctx.fillRect(rx, ry + oy, lw, lh);
            }
            ctx.restore();
            
            ctx.fillText(arrest.date, colCode, currentY);
            ctx.fillText(arrest.institution, colInst, currentY);
            ctx.fillText(arrest.charge, colCharge, currentY);
            ctx.fillText(arrest.term, colTerm, currentY);
            
            // Line separator
            ctx.beginPath();
            ctx.moveTo(margin, currentY + (tableRowHeight * 0.3));
            ctx.lineTo(width - margin, currentY + (tableRowHeight * 0.3));
            ctx.strokeStyle = "#ccc";
            ctx.lineWidth = 1;
            ctx.stroke();

            currentY += tableRowHeight;
        });

        // 5. Fingerprints & Other Info
        // Ensure we start below the table area, even if table was short
        // But if table was compressed, we start right after it
        currentY += (height * 0.01); // Minimal padding to move fingerprints up

        const fpY = currentY;
        
        // Fingerprints Box (Reduced width to 50%)
        const fpWidth = width * 0.5;
        const fpHeight = height * 0.12; // Reduced from 0.15
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 2;
        ctx.strokeRect(margin, fpY, fpWidth, fpHeight);
        
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "bold " + (width * 0.02) + "px 'Courier New'";
        ctx.fillText(label('fingerprints', "FINGERPRINTS"), margin, fpY - 5);
        
        // Draw 5 boxes for fingerprints
        const fpBoxW = fpWidth / 5;
        for(let i=0; i<5; i++) {
            ctx.strokeRect(margin + (i * fpBoxW), fpY, fpBoxW, fpHeight);
            // Simulate fingerprint smudge
            this.drawFingerprint(ctx, margin + (i * fpBoxW) + (fpBoxW/2), fpY + (fpHeight * 0.5), fpBoxW * 0.35);
        }

        // Other Info (Right Side)
        // Moved to start after fingerprints with some padding
        const otherInfoX = margin + fpWidth + (width * 0.05);
        ctx.fillText(label('otherInfo', "OTHER INFO"), otherInfoX, fpY - 5);
        
        ctx.font = (width * 0.018) + "px 'Courier New'";
        let otherInfoY = fpY + (height * 0.02);
        
        // Use dynamic notes if available, otherwise default
        const notes = this.config.notes || this.otherInfoFallback;
        
        notes.forEach(line => {
            ctx.fillText(line, otherInfoX, otherInfoY);
            // Underline
            ctx.beginPath();
            ctx.moveTo(otherInfoX, otherInfoY + 2);
            ctx.lineTo(width - margin, otherInfoY + 2);
            ctx.strokeStyle = "#aaa";
            ctx.lineWidth = 1;
            ctx.stroke();
            otherInfoY += (height * 0.022);
        });

        // 6. Photo (Attached on top right)
        // Position it where the photo is in the reference, but keep the polaroid style
        const photoWidth = width * 0.3;
        const photoHeight = photoWidth * 0.85;
        // Apply random layout offsets
        const photoX = width - margin - (photoWidth/2) - (width * 0.02) + this.layout.photo.xOffset;
        const photoY = (height * 0.25) + this.layout.photo.yOffset;

        ctx.save();
        ctx.translate(photoX, photoY);
        ctx.rotate(0.02 + this.layout.photo.rotation); // Slight rotation + random
        this.drawPolaroidFrame(ctx, -photoWidth/2, -photoHeight/2, photoWidth, photoHeight, imageSource);
        ctx.restore();

        // 7. Stamp (Bottom Right)
        // Moved slightly left and up
        this.drawStamp(ctx, stampText, (width * 0.75) + this.layout.stamp.xOffset, (height * 0.70) + this.layout.stamp.yOffset, this.layout.stamp.rotation);

        photoPlacement = {
            x: photoX,
            y: photoY,
            width: photoWidth,
            height: photoHeight,
            rotation: 0.02 + this.layout.photo.rotation
        };

        // Exhibition logo (bottom-left)
        this.drawExhibitionLogo(ctx, width, height);

        return { photoPlacement };
    }

    wrapText(ctx, text, maxWidth, maxLines = 2) {
        if (!text) return [''];
        const words = text.split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = line ? `${line} ${word}` : word;
            if (ctx.measureText(testLine).width <= maxWidth) {
                line = testLine;
                continue;
            }

            if (!line) {
                lines.push(this.truncateToWidth(ctx, word, maxWidth));
            } else {
                lines.push(line);
                line = word;
            }

            if (lines.length === maxLines - 1) {
                const remaining = [line, ...words.slice(i + 1)].join(' ').trim();
                lines.push(this.truncateToWidth(ctx, remaining, maxWidth));
                return lines.slice(0, maxLines);
            }
        }

        if (line) {
            if (ctx.measureText(line).width > maxWidth) {
                line = this.truncateToWidth(ctx, line, maxWidth);
            }
            lines.push(line);
        }

        return lines.slice(0, maxLines);
    }

    truncateToWidth(ctx, text, maxWidth) {
        const ellipsis = "...";
        if (ctx.measureText(text).width <= maxWidth) return text;
        let trimmed = text;
        while (trimmed.length && ctx.measureText(trimmed + ellipsis).width > maxWidth) {
            trimmed = trimmed.slice(0, -1);
        }
        return trimmed ? trimmed + ellipsis : ellipsis;
    }

    drawExhibitionLogo(ctx, width, height) {
        const maxWidth = width * 0.16;
        const margin = width * 0.045;

        ctx.save();
        if (this.exhibitionLogoImg.complete && this.exhibitionLogoImg.naturalWidth > 0) {
            const ratio = this.exhibitionLogoImg.naturalHeight / this.exhibitionLogoImg.naturalWidth || 1;
            const logoW = maxWidth;
            const logoH = logoW * ratio;
            const logoX = margin;
            const logoY = height - margin - logoH;
            ctx.globalAlpha = 0.9;
            ctx.drawImage(this.exhibitionLogoImg, logoX, logoY, logoW, logoH);
        } else {
            const logoW = maxWidth;
            const logoH = maxWidth * 0.35;
            const logoX = margin;
            const logoY = height - margin - logoH;
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(logoX, logoY, logoW, logoH);
            ctx.fillStyle = "#f0e6d2";
            ctx.font = `${logoW * 0.18}px 'Courier New'`;
            ctx.fillText(label('exhibitionFallback', "EXHIBITION"), logoX + logoW * 0.05, logoY + logoH * 0.65);
        }
        ctx.restore();
    }

    drawField(ctx, label, value, x, y, width) {
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "bold " + (ctx.canvas.width * 0.018) + "px 'Courier New'";
        ctx.textAlign = "left";
        ctx.fillText(label, x, y);
        
        // Increased spacing: value starts at 70% of width
        const valueX = x + (width * 0.70); 
        
        const redactionTokens = [
            this.defaultRedaction,
            this.config.aliases,
            "[REDACTED]",
            "[HIDDEN]"
        ].filter(Boolean);
        const shouldRedact = redactionTokens.includes(value);

        if (shouldRedact) {
             // Worn marker effect
             ctx.save();
             const h = ctx.canvas.width * 0.022;
             const w = width * 0.4; // Slightly shorter bar to fit
             const bx = valueX;
             const by = y - h * 0.7;
             
             // Draw multiple jagged lines to simulate marker
             ctx.fillStyle = "#050505";
             
             // Use seeded random for consistent look per layout generation
             let seed = this.layout.personalInfoRedactionSeeds[label] || (label.length * 100);
             
             for(let i=0; i<7; i++) {
                 const r1 = this.seededRandom(seed++);
                 const r2 = this.seededRandom(seed++);
                 const r3 = this.seededRandom(seed++);
                 const r4 = this.seededRandom(seed++);
                 
                 const oy = (r1 - 0.5) * (h * 0.3);
                 const ox = (r2 - 0.5) * (w * 0.02);
                 const lw = w + (r3 - 0.5) * (w * 0.05);
                 const lh = h * (0.5 + r4 * 0.3);
                 ctx.globalAlpha = 0.7 + this.seededRandom(seed++) * 0.3;
                 ctx.fillRect(bx + ox, by + oy, lw, lh);
             }
             ctx.restore();
        } else {
            ctx.font = (ctx.canvas.width * 0.022) + "px 'Courier New'";
            ctx.fillText(value, valueX, y);
        }
        
        // Underline
        ctx.beginPath();
        ctx.moveTo(valueX, y + 2);
        ctx.lineTo(x + width - 10, y + 2);
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    drawLineField(ctx, label, value, x, y, w, h) {
        ctx.fillStyle = "#1a1a1a";
        ctx.textAlign = "left";
        ctx.fillText(label, x, y);
        
        ctx.textAlign = "right";
        ctx.fillText(value, x + w, y);
        
        ctx.beginPath();
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x + w, y + 5);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    drawRecordIdBox(ctx, value, x, y, w, h, labelText = "RECORD ID#") {
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "bold " + (ctx.canvas.width * 0.018) + "px 'Courier New'";
        ctx.textAlign = "left";
        ctx.fillText(labelText, x, y + h/2);
        
        const boxX = x + (w * 0.3);
        const charW = (w * 0.6) / 10;
        
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1;
        
        for(let i=0; i<10; i++) {
            ctx.strokeRect(boxX + (i * charW), y, charW, h);
            if (i < value.length) {
                ctx.font = (h * 0.6) + "px 'Courier New'";
                ctx.textAlign = "center";
                ctx.fillText(value[i], boxX + (i * charW) + (charW/2), y + h * 0.7);
            }
        }
    }

    drawFingerprint(ctx, x, y, size) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        
        // Simple procedural fingerprint (concentric ellipses with noise)
        for(let i=0; i<5; i++) {
            ctx.beginPath();
            ctx.ellipse(0, 0, size * (0.2 + i*0.15), size * (0.3 + i*0.2), 0, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        
        // Noise
        for(let i=0; i<50; i++) {
            const rx = (Math.random() - 0.5) * size * 2;
            const ry = (Math.random() - 0.5) * size * 2.5;
            ctx.fillRect(rx, ry, 2, 2);
        }
        
        ctx.restore();
    }

    drawSeal(ctx, x, y, radius) {
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#1a1a1a"; 
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.95, 0, Math.PI * 2);
        ctx.strokeStyle = "#f0e6d2";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#f0e6d2";
        ctx.font = (radius) + "px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("★", 0, 5);
        ctx.restore();
    }

    drawPolaroidFrame(ctx, x, y, w, h, img) {
        const border = w * 0.05;
        const bottomBorder = h * 0.2;
        
        // Shadow
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;

        ctx.fillStyle = "#fff";
        ctx.fillRect(x - border, y - border, w + (border*2), h + border + bottomBorder);
        
        ctx.shadowColor = "transparent";

        if (img) {
            ctx.save();
            // Apply Vintage / B&W Filter to the photo content
            // This ensures consistency across all views (Capture, Real-time, AI)
            // Added blur(0.5px) to degrade quality slightly
            ctx.filter = "grayscale(1) contrast(1.2) brightness(1.1) blur(0.5px)";
            ctx.drawImage(img, x, y, w, h);
            
            // Force B&W using composite operation (Safari fallback/enforcement)
            ctx.globalCompositeOperation = "saturation";
            ctx.fillStyle = "#000"; // Black/White have 0 saturation
            ctx.fillRect(x, y, w, h);
            
            ctx.restore();
        } else {
            ctx.fillStyle = "#333";
            ctx.fillRect(x, y, w, h);
        }

        // Paperclip
        // Shifted right and rotated to avoid covering the face/center
        this.drawPaperclip(ctx, x + (w * 0.6), y - border);
    }

    drawPaperclip(ctx, x, y) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(0.25); // Rotation to look more natural
        
        // Scale based on canvas size?
        const s = 0.8;
        ctx.scale(s, s);
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-8, -10);
        ctx.lineTo(-8, 20);
        ctx.arc(0, 20, 8, Math.PI, 0, true);
        ctx.lineTo(8, -20);
        ctx.arc(0, -20, 8, 0, Math.PI, true);
        ctx.lineTo(-4, 10);
        ctx.stroke();
        ctx.restore();
    }

    wrapTextRedacted(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let lineY = y;

        // Random seed for consistent redaction per render (simple hash)
        let seed = 123;
        const random = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };

        for(let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            
            if (testWidth > maxWidth && n > 0) {
                this.drawLineWithRedaction(ctx, line, x, lineY, random);
                line = words[n] + ' ';
                lineY += lineHeight;
            }
            else {
                line = testLine;
            }
        }
        this.drawLineWithRedaction(ctx, line, x, lineY, random);
    }

    drawLineWithRedaction(ctx, line, x, y, randomFn) {
        const words = line.split(' ');
        let currentX = x;
        
        words.forEach(word => {
            const width = ctx.measureText(word + ' ').width;
            
            // 20% chance to redact a word
            if (randomFn() < 0.2 && word.length > 3) {
                ctx.fillStyle = "#000";
                // Draw black bar
                const h = parseInt(ctx.font) * 0.8;
                ctx.fillRect(currentX, y - h + (h*0.2), width - 2, h);
            } else {
                ctx.fillStyle = "#1a1a1a";
                ctx.fillText(word, currentX, y);
            }
            currentX += width;
        });
    }

    drawPaperTexture(ctx, width, height) {
        if (this.paperTextureImg.complete && this.paperTextureImg.naturalWidth !== 0) {
             ctx.drawImage(this.paperTextureImg, 0, 0, width, height);
        } else {
            // Fallback to procedural if image not loaded
            ctx.save();
            // Grain
            ctx.fillStyle = "rgba(100, 90, 80, 0.04)";
            for (let i = 0; i < width * height * 0.0002; i++) {
                const x = Math.random() * width;
                const y = Math.random() * height;
                const s = Math.random() * 2 + 1;
                ctx.fillRect(x, y, s, s);
            }
            // Stains/Discoloration
            ctx.fillStyle = "rgba(60, 40, 20, 0.03)";
            for (let i = 0; i < 8; i++) {
                 const x = Math.random() * width;
                 const y = Math.random() * height;
                 const r = Math.random() * (width * 0.2) + (width * 0.05);
                 ctx.beginPath();
                 ctx.arc(x, y, r, 0, Math.PI * 2);
                 ctx.fill();
            }
            ctx.restore();
        }
    }

    drawStamp(ctx, text, x, y, rotation) {
        if (this.stampImg.complete && this.stampImg.naturalWidth !== 0) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation !== undefined ? rotation : (Math.random() * 0.8) - 0.4); 
            
            // Scale stamp relative to canvas width
            const stampWidth = ctx.canvas.width * 0.35;
            const ratio = this.stampImg.naturalHeight / this.stampImg.naturalWidth;
            const stampHeight = stampWidth * ratio;

            // Draw centered on x, y
            ctx.globalAlpha = 0.6;
            ctx.drawImage(this.stampImg, -stampWidth/2, -stampHeight/2, stampWidth, stampHeight);
            ctx.restore();
        } else {
            // Fallback to procedural stamp
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation !== undefined ? rotation : (Math.random() * 0.4 - 0.2));

            const fontSize = ctx.canvas.width * 0.05;
            ctx.font = "bold " + fontSize + "px sans-serif";
            const metrics = ctx.measureText(text);
            const textWidth = metrics.width;
            const textHeight = fontSize;
            const padding = fontSize * 0.4;
            
            // Stamp Color (Faded Red)
            const color = "rgba(200, 20, 20, 0.5)";
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 4;
            
            // Outer Border
            ctx.beginPath();
            ctx.rect(-textWidth/2 - padding, -textHeight/2 - padding, textWidth + padding*2, textHeight + padding*2);
            ctx.stroke();
            
            // Inner Border
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(-textWidth/2 - padding + 6, -textHeight/2 - padding + 6, textWidth + padding*2 - 12, textHeight + padding*2 - 12);
            ctx.stroke();

            // Text
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, 0, 0);
            
            // Grunge effect on stamp (random clear rects)
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0,0,0,1)";
            for(let i=0; i<50; i++) {
                const rx = (Math.random() - 0.5) * (textWidth + padding*3);
                const ry = (Math.random() - 0.5) * (textHeight + padding*3);
                ctx.fillRect(rx, ry, Math.random()*3, Math.random()*3);
            }

            ctx.restore();
        }
    }
}
