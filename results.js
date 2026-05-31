const API_BASE = 'https://pathify-51pd.onrender.com';

let resultsData = [];
let currentResult = null;

document.addEventListener('DOMContentLoaded', () => {
    const sessionId = localStorage.getItem('pathified_session');
    if (!sessionId) {
        window.location.href = 'index.html';
        return;
    }

    if (typeof EMAILJS_PUBLIC_KEY !== 'undefined') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
    }

    showResultsSpinner();
    fetchResults(sessionId);
    setupRetake();
    setupEmail();
});

// ─── Loading Spinner ──────────────────────────────────────────────────────────
function showResultsSpinner() {
    const grid = document.getElementById('results-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="results-spinner-wrap" id="results-spinner-wrap">
            <div class="results-spinner">
                <div class="spinner-ring"></div>
                <div class="spinner-ring spinner-ring--2"></div>
                <div class="spinner-ring spinner-ring--3"></div>
            </div>
            <p class="results-spinner-label">Mapping your career paths...</p>
        </div>
    `;
}

// ─── Fetch Results ────────────────────────────────────────────────────────────
async function fetchResults(sessionId) {
    try {
        const res = await fetch(`${API_BASE}/result/${sessionId}`);
        if (!res.ok) throw new Error('Failed to fetch results');

        let data = await res.json();

        if (!data || data.length === 0) {
            showErrorState('No matches found. Please retake the quiz.');
            return;
        }

        // Apply Match Percentage Rules
        const seenPcts = new Set();
        data.forEach(item => {
            let pct = Math.round((item.match_score * 100) / 5) * 5;
            if (pct > 95) pct = 95;
            if (pct < 55) pct = 55;
            while (seenPcts.has(pct) && pct > 55) {
                pct -= 5;
            }
            seenPcts.add(pct);
            item.display_pct = pct;
        });

        resultsData = data.slice(0, 3); // Top 3
        renderCards();
    } catch (err) {
        console.error(err);
        showErrorState('Something went wrong. Please retake the quiz.');
    }
}

// ─── Error State ──────────────────────────────────────────────────────────────
function showErrorState(message) {
    const grid = document.getElementById('results-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="results-error-state">
            <div class="results-error-icon">⚠</div>
            <p class="results-error-msg">${message}</p>
            <button class="btn-primary" onclick="retakeQuiz()" style="margin-top: 1.5rem;">Retake the Quiz</button>
        </div>
    `;
}

// ─── Render Cards ─────────────────────────────────────────────────────────────
function renderCards() {
    const grid = document.getElementById('results-grid');
    if (!grid) return;
    grid.innerHTML = '';

    resultsData.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = `r-card ${idx === 0 ? 'rank-1' : ''}`;
        card.style.opacity = 0;
        card.style.transform = 'translateY(24px)';

        const rankLabel = idx === 0 ? "#1 Best Match" : (idx === 1 ? "#2 Strong Fit" : "#3 Worth Exploring");

        card.innerHTML = `
            <div class="r-rank">${rankLabel}</div>
            <div class="r-field">${item.title}</div>
            <div class="r-pct" data-target="${item.display_pct}">0%</div>
            <div class="r-desc">${item.field}</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary, var(--brown-soft)); margin-top: 0.5rem; margin-bottom: 1rem;">
                Salary: ${item.salary_range || 'Varies'}
            </div>
            <div class="r-bar-wrap">
                <div class="r-bar-fill" style="width:0%"></div>
            </div>
            <a href="#" class="r-link">See full breakdown &rarr;</a>
        `;

        card.addEventListener('click', (e) => {
            e.preventDefault();
            openModal(item, rankLabel);
        });

        grid.appendChild(card);

        // Staggered reveal + animate match % and progress bar
        const delay = 120 + (idx * 180);
        setTimeout(() => {
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease, box-shadow 0.3s ease';
            card.style.opacity = 1;
            card.style.transform = 'translateY(0)';

            // Animate the percentage counter
            setTimeout(() => {
                animateCounter(card.querySelector('.r-pct'), item.display_pct);
                const bar = card.querySelector('.r-bar-fill');
                if (bar) bar.style.width = `${item.display_pct}%`;
            }, 350);
        }, delay);
    });
}

// ─── Animated Counter (0% → actual%) over 1 second ───────────────────────────
function animateCounter(el, target) {
    if (!el) return;
    const duration = 1000; // ms
    const start = performance.now();

    function step(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(eased * target);
        el.textContent = `${value}%`;

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            el.textContent = `${target}%`;
        }
    }
    requestAnimationFrame(step);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
const modal = document.getElementById('modal');
const backdrop = document.getElementById('modal-backdrop');
const modalClose = document.getElementById('modal-close');

function openModal(item, rankLabel) {
    currentResult = item;

    document.getElementById('m-rank').textContent = rankLabel;
    document.getElementById('m-field').textContent = item.title;

    // Animate modal percentage too
    const mPctEl = document.getElementById('m-pct');
    mPctEl.textContent = '0%';
    setTimeout(() => animateCounter(mPctEl, item.display_pct), 300);

    document.getElementById('m-desc').textContent = `${item.field} - ${item.description || ''}`;

    // Work Environment & Salary
    const strengthsRow = document.getElementById('m-strengths');
    strengthsRow.innerHTML = '';

    if (item.work_environment) {
        const tag1 = document.createElement('span');
        tag1.className = 'tag';
        tag1.textContent = 'Env: ' + item.work_environment;
        strengthsRow.appendChild(tag1);
    }

    if (item.salary_range) {
        const tag2 = document.createElement('span');
        tag2.className = 'tag';
        tag2.textContent = 'Salary: ' + item.salary_range;
        strengthsRow.appendChild(tag2);
    }

    if (!item.work_environment && !item.salary_range) {
        strengthsRow.innerHTML = '<span class="tag">Not specified</span>';
    }

    // Skills
    const considerationsRow = document.getElementById('m-considerations');
    considerationsRow.innerHTML = '';
    let skillsArray = [];
    if (Array.isArray(item.skills)) {
        skillsArray = item.skills;
    } else if (typeof item.skills === 'string') {
        skillsArray = item.skills.split(',').map(s => s.trim());
    }

    if (skillsArray.length) {
        skillsArray.forEach(c => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = c;
            considerationsRow.appendChild(tag);
        });
    } else {
        considerationsRow.innerHTML = '<span class="tag">No skills specified</span>';
    }

    // Roles
    const existing = document.querySelector('.modal-roles');
    if (existing) existing.remove();

    let rolesArray = [];
    if (Array.isArray(item.roles)) {
        rolesArray = item.roles;
    } else if (typeof item.roles === 'string') {
        rolesArray = item.roles.split(',').map(r => r.trim());
    }

    if (rolesArray.length) {
        const rolesContainer = document.createElement('div');
        rolesContainer.className = 'modal-roles';
        rolesContainer.innerHTML = `
            <div class="modal-section-title">Roles you could grow into</div>
            <ul style="padding-left: 1.5rem; margin-top: 0.5rem; color: var(--text-secondary, var(--brown-soft));">
                ${rolesArray.map(r => `<li>${r}</li>`).join('')}
            </ul>
        `;
        const footer = document.querySelector('.modal-footer');
        if (footer) footer.before(rolesContainer);
        else document.querySelector('.modal-content').appendChild(rolesContainer);
    }

    modal.classList.add('active');
    backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    modal.classList.remove('active');
    backdrop.classList.remove('active');
    document.body.style.overflow = '';
}

if (modalClose) modalClose.addEventListener('click', closeModal);
if (backdrop) backdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ─── Share ────────────────────────────────────────────────────────────────────
const shareBtn = document.getElementById('share-btn');
const shareConfirm = document.getElementById('share-confirm');
if (shareBtn && shareConfirm) {
    shareBtn.addEventListener('click', () => {
        if (!currentResult) return;
        const shareText = `I got ${currentResult.title} on Pathified — find your CS path at pathified.com`;
        navigator.clipboard.writeText(shareText).then(() => {
            shareConfirm.style.opacity = '1';
            setTimeout(() => { shareConfirm.style.opacity = '0'; }, 2500);
        });
    });
}

// ─── Retake ───────────────────────────────────────────────────────────────────
function retakeQuiz() {
    localStorage.removeItem('pathified_session');
    localStorage.removeItem('pathified_answers');
    localStorage.removeItem('pathified_current_question');
    window.location.href = 'quiz.html';
}

function setupRetake() {
    const retakeBtn = document.getElementById('retake-btn');
    if (!retakeBtn) return;
    retakeBtn.addEventListener('click', retakeQuiz);
}

// ─── Email ────────────────────────────────────────────────────────────────────
function setupEmail() {
    const emailBtn = document.getElementById('results-email-btn');
    const emailInput = document.getElementById('results-email');
    const emailConfirm = document.getElementById('email-confirm');

    if (!emailBtn || !emailInput || !emailConfirm) return;

    emailBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email || !email.includes('@')) {
            emailInput.style.borderColor = 'red';
            return;
        }
        emailInput.style.borderColor = '';

        emailBtn.textContent = 'Sending...';
        emailBtn.disabled = true;

        if (typeof emailjs === 'undefined' || typeof EMAILJS_SERVICE_ID === 'undefined') {
            console.error('EmailJS not configured');
            emailBtn.textContent = 'Email not configured';
            emailBtn.disabled = false;
            return;
        }

        if (!resultsData || resultsData.length === 0) {
            emailBtn.textContent = 'Error — no results to send';
            emailBtn.disabled = false;
            return;
        }

        const r = resultsData;
        const formatArr = (arr) => Array.isArray(arr) ? arr.join(', ') : (arr || '');

        try {
            await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                to_email: email,

                field_1: r[0]?.title || '',
                percentage_1: r[0]?.display_pct || '',
                explanation_1: r[0]?.field || '',
                strength_1_a: formatArr(r[0]?.skills),
                strength_1_b: r[0]?.work_environment || '',
                strength_1_c: r[0]?.salary_range || '',
                consideration_1_a: formatArr(r[0]?.roles),
                consideration_1_b: '',
                role_1_a: '',
                role_1_b: '',
                role_1_c: '',

                field_2: r[1]?.title || '',
                percentage_2: r[1]?.display_pct || '',
                explanation_2: r[1]?.field || '',
                strength_2_a: formatArr(r[1]?.skills),
                strength_2_b: r[1]?.work_environment || '',
                strength_2_c: r[1]?.salary_range || '',
                consideration_2_a: formatArr(r[1]?.roles),
                consideration_2_b: '',
                role_2_a: '',
                role_2_b: '',
                role_2_c: '',

                field_3: r[2]?.title || '',
                percentage_3: r[2]?.display_pct || '',
                explanation_3: r[2]?.field || '',
                strength_3_a: formatArr(r[2]?.skills),
                strength_3_b: r[2]?.work_environment || '',
                strength_3_c: r[2]?.salary_range || '',
                consideration_3_a: formatArr(r[2]?.roles),
                consideration_3_b: '',
                role_3_a: '',
                role_3_b: '',
                role_3_c: '',
            });

            emailConfirm.style.display = 'block';
            document.getElementById('email-results-form').style.display = 'none';
            emailBtn.textContent = '✓ Sent';

        } catch (err) {
            console.error('EmailJS error:', err);
            emailBtn.textContent = 'Failed — try again';
            emailBtn.disabled = false;
        }
    });
}