const API_BASE = '/api';

// DOM Elements
const innerEls = document.getElementById('quiz-inner');
const questionText = document.getElementById('question-text');
const optionsContainer = document.getElementById('options-container');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const questionCounter = document.getElementById('question-counter');
const progressLabel = document.getElementById('progress-label');
const loadingOverlay = document.getElementById('loading-overlay');
const fullLoader = document.getElementById('full-loader');
const loadingText = document.getElementById('loading-text');

const TOTAL_QUESTIONS = 20;
let isTransitioning = false;

// ─── Initialization ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const sessionId = localStorage.getItem('pathified_session');
    const currentQuestionId = localStorage.getItem('pathified_current_question');

    // Hide optional/back buttons from old design
    const optionalContainer = document.getElementById('optional-container');
    const backBtn = document.getElementById('back-btn');
    if (optionalContainer) optionalContainer.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';

    if (sessionId && currentQuestionId) {
        resumeQuiz(sessionId, currentQuestionId);
    } else {
        showProfileForm();
    }
});

// ─── Loading States ───────────────────────────────────────────────────────────
function showLoading(msg = 'Loading...') {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (loadingText) loadingText.textContent = msg;
    if (innerEls) {
        innerEls.style.transition = 'opacity 0.25s ease';
        innerEls.style.opacity = '0';
    }
}

function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (innerEls) {
        innerEls.style.transition = 'opacity 0.35s ease';
        innerEls.style.opacity = '1';
    }
}

function showFullLoading(msg = 'Computing results...') {
    if (fullLoader) {
        fullLoader.style.display = 'flex';
        const flText = fullLoader.querySelector('.loading-text');
        if (flText) flText.textContent = msg;
    }
    document.body.style.overflow = 'hidden';
}

function hideFullLoading() {
    if (fullLoader) fullLoader.style.display = 'none';
    document.body.style.overflow = '';
}

// ─── Skeleton Loader ──────────────────────────────────────────────────────────
function showSkeleton() {
    if (!innerEls) return;
    // Fade out current content first
    innerEls.style.transition = 'opacity 0.2s ease';
    innerEls.style.opacity = '0';

    setTimeout(() => {
        if (questionText) {
            questionText.innerHTML = '<div class="skeleton skeleton-line skeleton-line--lg"></div><div class="skeleton skeleton-line skeleton-line--md"></div>';
        }
        if (optionsContainer) {
            optionsContainer.innerHTML = `
                <div class="skeleton skeleton-option"></div>
                <div class="skeleton skeleton-option"></div>
                <div class="skeleton skeleton-option"></div>
                <div class="skeleton skeleton-option"></div>
            `;
        }
        innerEls.style.transition = 'opacity 0.25s ease';
        innerEls.style.opacity = '1';
    }, 200);
}

// ─── Profile Form ─────────────────────────────────────────────────────────────
function showProfileForm() {
    if (optionsContainer) optionsContainer.style.display = 'none';
    if (questionText) questionText.innerHTML = "Before we start, tell us a bit about yourself.";

    updateProgress(0); // show 0% on progress bar

    const formHtml = `
        <div class="profile-form" id="profile-form" style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem;">
            <input type="number" id="pf-age" placeholder="Age" required class="quiz-input" style="padding: 0.8rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);" />
            <select id="pf-education" required class="quiz-input" style="padding: 0.8rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                <option value="" disabled selected>Education Level</option>
                <option value="High School">High School</option>
                <option value="Bachelors">Bachelors</option>
                <option value="Masters">Masters</option>
                <option value="PhD">PhD</option>
            </select>
            <input type="text" id="pf-field" placeholder="Current Field of Study/Work" required class="quiz-input" style="padding: 0.8rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);" />
            <input type="text" id="pf-country" placeholder="Country" required class="quiz-input" style="padding: 0.8rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);" />
            <button id="pf-submit" class="btn-primary" style="margin-top: 1rem;">Start Quiz</button>
        </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = formHtml;
    innerEls.appendChild(div);

    document.getElementById('pf-submit').addEventListener('click', async () => {
        const age = document.getElementById('pf-age').value;
        const ed = document.getElementById('pf-education').value;
        const field = document.getElementById('pf-field').value;
        const country = document.getElementById('pf-country').value;

        if (!age || !ed || !field || !country) {
            alert('Please fill out all fields.');
            return;
        }

        showLoading('Starting session...');
        try {
            const res = await fetch(`${API_BASE}/session/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    age: parseInt(age),
                    education_level: ed,
                    current_field: field,
                    country: country
                })
            });

            if (!res.ok) throw new Error('Failed to start session');
            const data = await res.json();

            localStorage.setItem('pathified_session', data.session_id);
            if (data.first_question && data.first_question.question_id) {
                localStorage.setItem('pathified_current_question', data.first_question.question_id);
            }
            localStorage.setItem('pathified_answers', JSON.stringify([]));

            div.remove();
            if (optionsContainer) optionsContainer.style.display = 'grid';
            renderQuestion(data.first_question);
        } catch (err) {
            console.error(err);
            showRetry('Failed to start session. Please try again.', showProfileForm);
        }
    });
}

// ─── Resume Quiz ──────────────────────────────────────────────────────────────
async function resumeQuiz(sessionId, questionId) {
    showSkeleton();
    try {
        const res = await fetch(`${API_BASE}/question/${questionId}`);
        if (!res.ok) {
            if (res.status === 404) {
                localStorage.clear();
                window.location.reload();
                return;
            }
            throw new Error('Failed to fetch question');
        }
        const question = await res.json();

        // Handle complete flag
        if (question.complete === true) {
            computeResults(sessionId);
            return;
        }

        if (optionsContainer) optionsContainer.style.display = 'grid';
        renderQuestion(question);
    } catch (err) {
        console.error(err);
        showRetry('Failed to load question.', () => resumeQuiz(sessionId, questionId));
    }
}

// ─── Render Question ──────────────────────────────────────────────────────────
function renderQuestion(question) {
    if (isTransitioning) return;

    // Handle complete flag from API
    if (question && question.complete === true) {
        const sessionId = localStorage.getItem('pathified_session');
        computeResults(sessionId);
        return;
    }

    if (question && question.question_id) {
        localStorage.setItem('pathified_current_question', question.question_id);
    }

    // Step 1: Fade out
    innerEls.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    innerEls.style.opacity = '0';
    innerEls.style.transform = 'translateY(8px)';

    // Step 2: Show skeleton briefly while content loads
    setTimeout(() => {
        // Inject skeleton placeholders
        if (questionText) {
            questionText.innerHTML = '<div class="skeleton skeleton-line skeleton-line--lg"></div><div class="skeleton skeleton-line skeleton-line--md"></div>';
        }
        if (optionsContainer) {
            optionsContainer.innerHTML = `
                <div class="skeleton skeleton-option"></div>
                <div class="skeleton skeleton-option"></div>
                <div class="skeleton skeleton-option"></div>
                <div class="skeleton skeleton-option"></div>
            `;
        }

        // Fade skeleton in
        innerEls.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        innerEls.style.opacity = '1';
        innerEls.style.transform = 'translateY(0)';

        // Step 3: After tiny delay, swap real content in with another fade
        setTimeout(() => {
            innerEls.style.transition = 'opacity 0.2s ease';
            innerEls.style.opacity = '0';

            setTimeout(() => {
                if (questionText) questionText.textContent = question.question_text;
                if (optionsContainer) optionsContainer.innerHTML = '';

                if (question.options && question.options.length > 0) {
                    question.options.forEach((opt, index) => {
                        const btn = document.createElement('button');
                        btn.className = 'quiz-option';

                        const labelSpan = document.createElement('strong');
                        labelSpan.textContent = opt.option_label + '. ';
                        labelSpan.style.marginRight = '0.5rem';
                        btn.appendChild(labelSpan);

                        const textSpan = document.createElement('span');
                        textSpan.textContent = opt.option_text;
                        btn.appendChild(textSpan);

                        btn.style.opacity = '0';
                        btn.style.transform = 'translateY(8px)';

                        btn.onclick = () => submitAnswer(question.question_id, opt.option_label, btn);
                        if (optionsContainer) optionsContainer.appendChild(btn);

                        setTimeout(() => {
                            btn.style.transition = 'opacity 0.3s ease, transform 0.3s ease, border-color 0.2s, background 0.2s';
                            btn.style.opacity = '1';
                            btn.style.transform = 'translateY(0)';
                        }, 60 + (index * 60));
                    });
                }

                updateProgress();
                hideLoading();

                innerEls.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                innerEls.style.opacity = '1';
                innerEls.style.transform = 'translateY(0)';
            }, 150);
        }, 300); // skeleton visible for 300ms
    }, 250);
}

// ─── Submit Answer ─────────────────────────────────────────────────────────────
async function submitAnswer(questionId, optionLabel, btnElement) {
    if (isTransitioning) return;
    isTransitioning = true;

    const buttons = document.querySelectorAll('.quiz-option');
    buttons.forEach(b => {
        b.style.pointerEvents = 'none';
        if (b !== btnElement) b.style.opacity = '0.4';
    });
    btnElement.classList.add('selected');

    const sessionId = localStorage.getItem('pathified_session');

    try {
        const res = await fetch(`${API_BASE}/answer/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: parseInt(sessionId),
                question_id: questionId,
                option_label: optionLabel
            })
        });

        if (!res.ok) throw new Error('Failed to submit answer');
        const data = await res.json();

        let answers = JSON.parse(localStorage.getItem('pathified_answers') || '[]');
        answers.push({ question_id: questionId, option_label: optionLabel });
        localStorage.setItem('pathified_answers', JSON.stringify(answers));

        setTimeout(() => {
            isTransitioning = false;

            // Handle complete flag from API response
            if (data.complete === true) {
                computeResults(sessionId);
                return;
            }

            if (data.status === 'continue' && data.next_question) {
                renderQuestion(data.next_question);
            } else if (data.status === 'complete') {
                computeResults(sessionId);
            }
        }, 500);

    } catch (err) {
        console.error(err);
        isTransitioning = false;
        showRetry('Failed to submit answer.', () => submitAnswer(questionId, optionLabel, btnElement));
    }
}

// ─── Compute Results ──────────────────────────────────────────────────────────
async function computeResults(sessionId) {
    showFullLoading('Synthesizing your profile...');
    try {
        const res = await fetch(`${API_BASE}/result/compute/${sessionId}`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Failed to compute results');

        window.location.href = 'results.html';
    } catch (err) {
        console.error(err);
        hideFullLoading();
        showRetry('Failed to compute results.', () => computeResults(sessionId));
    }
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function updateProgress(overrideCount) {
    let answers = [];
    try {
        answers = JSON.parse(localStorage.getItem('pathified_answers') || '[]');
    } catch (e) {}

    const current = overrideCount !== undefined ? overrideCount : answers.length;
    const questionNumber = current + 1;
    let pct = (current / TOTAL_QUESTIONS) * 100;
    if (pct > 100) pct = 100;

    // Animate progress fill
    const fill = document.getElementById('progress-fill');
    if (fill) {
        fill.style.width = `${pct}%`;
    } else if (progressBar) {
        // Fallback: old #progress-bar element
        progressBar.style.width = `${pct}%`;
    }

    // Update counter label: "Question X of 20"
    if (questionCounter) {
        questionCounter.textContent = `Question ${Math.min(questionNumber, TOTAL_QUESTIONS)} of ${TOTAL_QUESTIONS}`;
    }
}

// ─── Error Handling UI ────────────────────────────────────────────────────────
function showRetry(msg, retryCallback) {
    hideLoading();
    hideFullLoading();

    const existing = document.getElementById('retry-container');
    if (existing) existing.remove();

    const retryDiv = document.createElement('div');
    retryDiv.id = 'retry-container';
    retryDiv.style.textAlign = 'center';
    retryDiv.style.marginTop = '2rem';

    const p = document.createElement('p');
    p.textContent = msg;
    p.style.color = 'var(--text-secondary, #666)';
    p.style.marginBottom = '1rem';

    const btn = document.createElement('button');
    btn.className = 'btn-ghost';
    btn.textContent = 'Try Again';
    btn.onclick = () => {
        retryDiv.remove();
        retryCallback();
    };

    retryDiv.appendChild(p);
    retryDiv.appendChild(btn);
    if (innerEls) innerEls.appendChild(retryDiv);
}