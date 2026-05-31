import os
import math
import random
from typing import List, Optional, Literal
from fastapi import FastAPI, HTTPException, Request, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator, Field
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Rate limiting ─────────────────────────────────────────────────────────────
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables
load_dotenv()

# ── Limiter setup (keyed by real client IP) ───────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Career Guidance Questionnaire API")

# Attach limiter + its 429 error handler to the app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://tiny-gnome-1acb73.netlify.app",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase client ───────────────────────────────────────────────────────────
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in environment variables")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# (API key middleware removed to support client-side Netlify deployment without leaking secrets)


# ── Column names for vectorisation ────────────────────────────────────────────
NUMERIC_COLS = [
    "math_required", "creativity_required", "social_required",
    "risk_tolerance", "physical_work", "leadership_required",
    "problem_solving", "attention_to_detail", "independence", "helping_others"
]

BOOLEAN_COLS = [
    "suitable_for_introverts", "suitable_for_extroverts", "requires_travel"
]

# ── Pydantic models ───────────────────────────────────────────────────────────

VALID_EDUCATION = {"high_school", "bachelors", "masters", "phd", "other"}
VALID_OPTION_LABELS = {"A", "B", "C", "D"}


class StartSessionRequest(BaseModel):
    age: int = Field(..., ge=16, le=60, description="Must be between 16 and 60")
    education_level: str
    current_field: str
    country: str
    user_id: Optional[str] = None

    @field_validator("education_level")
    @classmethod
    def validate_education(cls, v: str) -> str:
        normalised = v.strip().lower()
        if normalised not in VALID_EDUCATION:
            raise ValueError(
                f"education_level must be one of: {', '.join(sorted(VALID_EDUCATION))}"
            )
        return normalised


class SubmitAnswerRequest(BaseModel):
    session_id: str  # UUID stored as text in the DB
    question_id: str
    option_label: str

    @field_validator("option_label")
    @classmethod
    def validate_option_label(cls, v: str) -> str:
        upper = v.strip().upper()
        if upper not in VALID_OPTION_LABELS:
            raise ValueError(
                f"option_label must be one of: {', '.join(sorted(VALID_OPTION_LABELS))}"
            )
        return upper

    @field_validator("session_id")
    @classmethod
    def validate_session_uuid(cls, v: str) -> str:
        import uuid
        try:
            uuid.UUID(str(v))
        except ValueError:
            raise ValueError("session_id must be a valid UUID")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

def compute_cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Computes cosine similarity between two numeric vectors."""
    dot_product = sum(v1 * v2 for v1, v2 in zip(vec1, vec2))
    mag1 = math.sqrt(sum(v ** 2 for v in vec1))
    mag2 = math.sqrt(sum(v ** 2 for v in vec2))
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot_product / (mag1 * mag2)


def _get_session_or_raise(session_id: str) -> dict:
    """Fetch a session row; raise 404 if missing, 400 if already complete."""
    sess_res = (
        supabase.table("sessions")
        .select("session_id, is_complete, total_questions_seen")
        .eq("session_id", session_id)
        .execute()
    )
    if not sess_res.data:
        raise HTTPException(status_code=404, detail="Session not found")
    session = sess_res.data[0]
    if session.get("is_complete"):
        raise HTTPException(status_code=400, detail="Session already complete")
    return session


# ── Health check endpoints (exempt from API key) ──────────────────────────────

@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


# ── Session / Start ───────────────────────────────────────────────────────────

@app.post("/session/start")
@limiter.limit("10/day")
async def start_session(request: Request, req: StartSessionRequest):
    """Start a new session, create a profile, and fetch the root question.

    Rate limit: 10 requests per IP per day.
    """
    # 1. Insert user profile
    profile_data = {
        "user_id": req.user_id,
        "age": req.age,
        "education_level": req.education_level,
        "current_field": req.current_field,
        "country": req.country,
    }

    profile_res = supabase.table("user_profiles").insert(profile_data).execute()
    if not profile_res.data:
        raise HTTPException(status_code=500, detail="Failed to create user profile")
    profile_id = profile_res.data[0]["profile_id"]

    # 2. Insert session
    session_data = {
        "profile_id": profile_id,
        "is_complete": False,
        "total_questions_seen": 1,
    }
    session_res = supabase.table("sessions").insert(session_data).execute()
    if not session_res.data:
        raise HTTPException(status_code=500, detail="Failed to create session")
    session_id = session_res.data[0]["session_id"]

    # 3. Fetch first question (is_root_question = TRUE)
    questions_res = (
        supabase.table("questions").select("*").eq("is_root_question", True).execute()
    )
    if not questions_res.data:
        raise HTTPException(status_code=404, detail="No root question found")
    first_question = questions_res.data[0]

    # 4. Fetch options for the first question
    options_res = (
        supabase.table("options")
        .select("*")
        .eq("question_id", first_question["question_id"])
        .execute()
    )

    return {
        "session_id": session_id,
        "profile_id": profile_id,
        "first_question": {
            "question_id": first_question["question_id"],
            "question_text": first_question["question_text"],
            "options": options_res.data,
        },
    }


# ── Get Question ──────────────────────────────────────────────────────────────

@app.get("/question/{question_id}")
async def get_question(question_id: str):
    """Fetch a specific question by ID along with its options."""
    q_res = (
        supabase.table("questions")
        .select("*")
        .eq("question_id", question_id)
        .execute()
    )
    if not q_res.data:
        raise HTTPException(status_code=404, detail="Question not found")
    question = q_res.data[0]

    o_res = (
        supabase.table("options")
        .select("option_label, option_text")
        .eq("question_id", question_id)
        .execute()
    )

    return {
        "question_id": question["question_id"],
        "question_text": question["question_text"],
        "construct_name": question.get("construct_name"),
        "options": o_res.data,
    }


# ── Answer / Submit ───────────────────────────────────────────────────────────

@app.post("/answer/submit")
@limiter.limit("50/day")
async def submit_answer(request: Request, req: SubmitAnswerRequest):
    """Submit an answer, update progress, and return the next question.

    Rate limit: 50 requests per IP per day.
    Session guard: raises 404 if session missing, 400 if already complete.
    """
    # ── Session guard ─────────────────────────────────────────────────────────
    session = _get_session_or_raise(req.session_id)
    current_seen = session.get("total_questions_seen", 0)

    # 1. Fetch chosen option
    o_res = (
        supabase.table("options")
        .select("*")
        .eq("question_id", req.question_id)
        .eq("option_label", req.option_label)
        .execute()
    )
    if not o_res.data:
        raise HTTPException(status_code=404, detail="Option not found")
    option = o_res.data[0]

    # Fetch question to get depth
    q_res = (
        supabase.table("questions")
        .select("depth_level")
        .eq("question_id", req.question_id)
        .execute()
    )
    depth = q_res.data[0]["depth_level"] if q_res.data else 0

    # 2. Insert response
    resp_data = {
        "session_id": req.session_id,
        "question_id": req.question_id,
        "option_chosen": req.option_label,
        "score_signal": option.get("score_signal", {}),
        "question_depth": depth,
    }
    supabase.table("responses").insert(resp_data).execute()

    # 3. Update total_questions_seen
    supabase.table("sessions").update(
        {"total_questions_seen": current_seen + 1}
    ).eq("session_id", req.session_id).execute()

    # 4. Check stopping condition (≥ 20 questions answered)
    if current_seen + 1 >= 20:
        supabase.table("sessions").update({"is_complete": True}).eq(
            "session_id", req.session_id
        ).execute()
        return {"status": "complete", "message": "Quiz done"}

    # 5. Check for hardcoded next question
    next_q_id = option.get("next_question_id")
    if next_q_id:
        next_q_res = (
            supabase.table("questions")
            .select("*")
            .eq("question_id", next_q_id)
            .execute()
        )
        if next_q_res.data:
            next_q = next_q_res.data[0]
            next_o_res = (
                supabase.table("options")
                .select("option_label, option_text")
                .eq("question_id", next_q_id)
                .execute()
            )
            next_q["options"] = next_o_res.data
            return {"status": "continue", "next_question": next_q}

    # 6. Dynamic Branching: Compute unscored/weak columns
    resps_res = (
        supabase.table("responses")
        .select("score_signal, question_id")
        .eq("session_id", req.session_id)
        .execute()
    )
    answered_qids = [r["question_id"] for r in resps_res.data]

    col_counts = {col: 0 for col in NUMERIC_COLS + BOOLEAN_COLS}
    for r in resps_res.data:
        sig = r.get("score_signal")
        if isinstance(sig, dict):
            for k in sig.keys():
                if k in col_counts:
                    col_counts[k] += 1

    min_count = min(col_counts.values())

    if min_count >= 2:
        supabase.table("sessions").update({"is_complete": True}).eq(
            "session_id", req.session_id
        ).execute()
        return {"status": "complete", "message": "Quiz done"}

    weakest_cols = [k for k, v in col_counts.items() if v == min_count]

    # 7. Fetch candidate questions
    all_qs_res = (
        supabase.table("questions").select("*").eq("is_terminal", False).execute()
    )

    candidate_qs = []
    for q in all_qs_res.data:
        if q["question_id"] in answered_qids:
            continue
        targeted = q.get("columns_targeted") or []
        if any(col in weakest_cols for col in targeted):
            candidate_qs.append(q)

    if not candidate_qs:
        for q in all_qs_res.data:
            if q["question_id"] not in answered_qids:
                candidate_qs.append(q)

    if not candidate_qs:
        supabase.table("sessions").update({"is_complete": True}).eq(
            "session_id", req.session_id
        ).execute()
        return {"status": "complete", "message": "Quiz done"}

    next_q = random.choice(candidate_qs)
    next_o_res = (
        supabase.table("options")
        .select("option_label, option_text")
        .eq("question_id", next_q["question_id"])
        .execute()
    )
    next_q["options"] = next_o_res.data

    return {"status": "continue", "next_question": next_q}


# ── Result / Compute ──────────────────────────────────────────────────────────

@app.post("/result/compute/{session_id}")
async def compute_result(session_id: str):
    """Compute results for a session and generate top 5 career recommendations."""
    # 1. Fetch responses
    resp_res = (
        supabase.table("responses")
        .select("*")
        .eq("session_id", session_id)
        .execute()
    )
    if not resp_res.data:
        raise HTTPException(status_code=404, detail="No responses found for session")

    # Fetch session to get profile_id
    sess_res = (
        supabase.table("sessions")
        .select("profile_id")
        .eq("session_id", session_id)
        .execute()
    )
    profile_id = sess_res.data[0]["profile_id"] if sess_res.data else None

    numeric_scores = {col: [] for col in NUMERIC_COLS}
    boolean_scores = {col: [] for col in BOOLEAN_COLS}

    for resp in resp_res.data:
        signal = resp.get("score_signal")
        if not signal or not isinstance(signal, dict):
            continue
        for k, v in signal.items():
            if k in NUMERIC_COLS and v is not None:
                numeric_scores[k].append(v)
            elif k in BOOLEAN_COLS and v is not None:
                boolean_scores[k].append(v)

    user_vector = {"session_id": session_id, "profile_id": profile_id}

    # 2. Compute numeric averages
    for col in NUMERIC_COLS:
        scores = numeric_scores[col]
        user_vector[col] = sum(scores) / len(scores) if scores else 0.0

    # 3. Compute boolean majority vote
    for col in BOOLEAN_COLS:
        scores = boolean_scores[col]
        if not scores:
            user_vector[col] = False
            continue
        trues = sum(1 for x in scores if x)
        user_vector[col] = trues > (len(scores) - trues)

    # 4. Save user vector
    supabase.table("user_score_vectors").insert(user_vector).execute()

    # 5. Fetch careers and vectorise
    careers_res = supabase.table("careers").select("*").execute()
    if not careers_res.data:
        raise HTTPException(status_code=500, detail="No careers found in database")

    user_vec_list = []
    for col in NUMERIC_COLS:
        user_vec_list.append(user_vector[col] / 5.0)
    for col in BOOLEAN_COLS:
        user_vec_list.append(1.0 if user_vector[col] else 0.0)

    results = []
    for career in careers_res.data:
        career_vec_list = []
        for col in NUMERIC_COLS:
            val = career.get(col)
            career_vec_list.append((val / 5.0) if val else 0.0)
        for col in BOOLEAN_COLS:
            val = career.get(col)
            career_vec_list.append(1.0 if val else 0.0)

        sim = compute_cosine_similarity(user_vec_list, career_vec_list)
        results.append({"career_id": career["id"], "match_score": sim})

    results.sort(key=lambda x: x["match_score"], reverse=True)
    top_5 = results[:5]

    # 7. Insert recommendations
    recs = [
        {
            "session_id": session_id,
            "career_id": r["career_id"],
            "match_score": r["match_score"],
            "rank": i + 1,
        }
        for i, r in enumerate(top_5)
    ]
    supabase.table("career_recommendations").insert(recs).execute()

    return top_5


# ── Result / Fetch ────────────────────────────────────────────────────────────

@app.get("/result/{session_id}")
async def get_results(session_id: str):
    """Fetch the computed top 5 recommendations enriched with career details."""
    recs_res = (
        supabase.table("career_recommendations")
        .select("*, careers(*)")
        .eq("session_id", session_id)
        .order("rank")
        .execute()
    )

    if not recs_res.data:
        raise HTTPException(status_code=404, detail="Recommendations not found")

    output = []
    for rec in recs_res.data:
        career = rec.get("careers", {})
        output.append(
            {
                "rank": rec["rank"],
                "match_score": rec["match_score"],
                "career_id": rec["career_id"],
                "title": career.get("title"),
                "field": career.get("field"),
                "description": career.get("description"),
                "salary_range": career.get("salary_range"),
                "work_environment": career.get("work_environment"),
                "roles": career.get("roles"),
                "skills": career.get("skills"),
            }
        )

    return output
