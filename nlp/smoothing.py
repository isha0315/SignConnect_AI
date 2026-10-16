"""
nlp/smoothing.py — Grammar smoothing with debounced LanguageTool.

LanguageTool spawns a Java process — calling it per-frame causes
huge latency. We debounce: NLP correction runs ONLY on explicit
triggers (space, send, or after a cooldown period).

Rule-based sign-language expansion (telegraphic → fluent English)
is always applied instantly since it's pure Python dict lookup.
"""
import logging
import time
import threading

logger = logging.getLogger("signconnect.nlp")

# ============================================================
# LANGUAGE TOOL (lazy init, thread-safe)
# ============================================================

_nlp_tool = None
_nlp_lock = threading.Lock()
_nlp_init_attempted = False


def _get_nlp_tool():
    """Lazy-init LanguageTool to avoid import-time Java spawn."""
    global _nlp_tool, _nlp_init_attempted

    if _nlp_init_attempted:
        return _nlp_tool

    with _nlp_lock:
        if _nlp_init_attempted:
            return _nlp_tool
        _nlp_init_attempted = True
        try:
            import language_tool_python
            _nlp_tool = language_tool_python.LanguageTool('en-US')
            logger.info("LanguageTool initialized successfully")
        except Exception as e:
            logger.warning("LanguageTool failed to load: %s", e)
            _nlp_tool = None

    return _nlp_tool


# ============================================================
# SIGN LANGUAGE EXPANSION RULES
# ============================================================

EXPANSION_RULES = {
    "I GO STORE": "I am going to the store.",
    "HE GO STORE": "He is going to the store.",
    "YOU WANT FOOD": "Do you want some food?",
    "I PAIN": "I am in pain.",
    "WATER PLEASE": "Can I have some water, please?",
    "HELP ME": "Can someone please help me?",
    "WHERE YOU": "Where are you?",
    "WHAT NAME": "What is your name?",
    "I DOCTOR": "I need to see a doctor.",
    "YOU FRIEND": "You are my friend.",
    "I GOOD": "I am feeling good.",
    "HOW YOU": "How are you doing?",
    "I NAME": "My name is",
    "YOU GOOD": "Are you okay?",
    "WHAT TIME": "What time is it?",
}


# ============================================================
# WORD-LEVEL SIBI GESTURE MAP (#12)
# ============================================================
# Common whole-word signs that map to complete words/phrases.
# These bypass the letter-by-letter spelling for frequent signs.

WORD_GESTURES = {
    "THANKYOU": "THANK YOU",
    "HOWAREYOU": "HOW ARE YOU",
    "IAMFINE": "I AM FINE",
    "NICETOMEETYOU": "NICE TO MEET YOU",
    "SEEYOULATER": "SEE YOU LATER",
    "GOODMORNING": "GOOD MORNING",
    "GOODNIGHT": "GOOD NIGHT",
    "ILOVEYOU": "I LOVE YOU",
    "EXCUSEME": "EXCUSE ME",
    "PLEASEWAIT": "PLEASE WAIT",
    "NOPROBLEM": "NO PROBLEM",
    "IMSORRY": "I AM SORRY",
    "GOODJOB": "GOOD JOB",
    "TAKECARE": "TAKE CARE",
}


def expand_word_gesture(word):
    """If the current_word matches a word-level gesture, expand it."""
    return WORD_GESTURES.get(word.upper(), None)


# ============================================================
# DEBOUNCED NLP SMOOTHING CACHE
# ============================================================

_smooth_cache = {}
_smooth_cache_lock = threading.Lock()
_CACHE_TTL = 5.0  # seconds


def smooth_sentence(sentence_arr, use_nlp=False):
    """
    Apply rule-based expansion always.
    Apply LanguageTool correction ONLY when use_nlp=True
    (triggered on space/send, NOT per-frame).

    Args:
        sentence_arr: list of words like ["HELLO", "HOW", "YOU"]
        use_nlp: whether to run LanguageTool (expensive). Only on
                 space/send triggers, never per-frame.
    """
    if not sentence_arr:
        return ""

    raw = " ".join(sentence_arr).strip()
    if not raw:
        return ""

    s = raw.upper()

    # 1. Rule-based Sign Language Expansion (always, instant)
    for key, val in EXPANSION_RULES.items():
        if key in s:
            s = s.replace(key, val)

    # Normalize case
    s = s.capitalize()

    # 2. Grammar Correction via LanguageTool (only when triggered)
    if use_nlp:
        tool = _get_nlp_tool()
        if tool:
            # Check cache first
            cache_key = s
            with _smooth_cache_lock:
                cached = _smooth_cache.get(cache_key)
                if cached and (time.time() - cached[1]) < _CACHE_TTL:
                    return cached[0]

            try:
                import language_tool_python
                matches = tool.check(s)
                corrected = language_tool_python.utils.correct(s, matches)
                with _smooth_cache_lock:
                    _smooth_cache[cache_key] = (corrected, time.time())
                return corrected
            except Exception:
                pass

    return s
