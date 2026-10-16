"""
nlp/autocomplete.py — Autocomplete and sentence suggestions.

Provides word and sentence completion from a curated dictionary
of common daily-use phrases and individual words.
"""
import logging

logger = logging.getLogger("signconnect.nlp")


# ============================================================
# AUTO-COMPLETE DICTIONARY
# ============================================================

AUTOCOMPLETE_WORDS = [
    # Basic Daily Sentences (Prioritized)
    "HOW ARE YOU", "I AM FINE", "NICE TO MEET YOU", "WHAT IS YOUR NAME",
    "WHERE ARE YOU", "I NEED HELP", "HAVE A GOOD DAY", "SEE YOU LATER",
    "THANK YOU SO MUCH", "I DO NOT UNDERSTAND", "PLEASE REPEAT",
    "EXCUSE ME", "I LOVE YOU", "GOOD MORNING", "GOOD NIGHT",

    # Individual Words & Daily Vocabulary
    "HELLO", "HOW", "ARE", "YOU", "PLEASE", "THANK", "HELP",
    "YES", "NO", "STOP", "DANGER", "EMERGENCY", "DOCTOR",
    "POLICE", "WATER", "PAIN", "FIRE", "GOOD", "MORNING",
    "NIGHT", "FRIEND", "NAME", "WHAT", "STORE", "FOOD",
    "WELCOME", "SORRY", "TODAY", "TOMORROW", "FAMILY",
    "HAPPY", "HUNGRY", "DRINK", "BATHROOM", "MEDICINE"
]


def get_suggestion(current_word):
    """
    Return the remaining characters to complete a word/phrase.

    Example: "HEL" → "LO" (completing "HELLO")
    """
    if not current_word:
        return ""

    current_word = str(current_word).upper().strip()

    for word in AUTOCOMPLETE_WORDS:
        if word.startswith(current_word) and word != current_word:
            return word[len(current_word):]

    return ""


# ============================================================
# SENTENCE RECOMMENDATIONS & CONTEXTUAL GESTURE FOLLOWUPS
# ============================================================

GESTURE_FOLLOWUPS = {
    "HELLO": ["HOW ARE YOU", "NICE TO MEET YOU", "GOOD MORNING", "MY FRIEND"],
    "HI": ["HOW ARE YOU", "NICE TO MEET YOU", "GOOD MORNING"],
    "GOOD MORNING": ["HOW ARE YOU", "HAVE A GOOD DAY", "NICE TO MEET YOU", "THANK YOU"],
    "GOOD NIGHT": ["SEE YOU TOMORROW", "SLEEP WELL", "TAKE CARE"],
    "GOODBYE": ["SEE YOU LATER", "TAKE CARE", "HAVE A NICE DAY"],
    "HOW ARE YOU": ["I AM FINE", "WHAT ABOUT YOU", "ALL GOOD", "THANK YOU"],
    "NICE TO MEET YOU": ["NICE TO MEET YOU TOO", "HOW ARE YOU", "HAVE A GOOD DAY"],
    "I AM FINE": ["THANK YOU", "AND YOU", "HAVE A GOOD DAY"],
    "WATER": ["PLEASE", "I NEED WATER", "CAN I HAVE WATER", "THANK YOU"],
    "HELP": ["PLEASE HELP ME", "I NEED HELP", "EMERGENCY", "CALL DOCTOR"],
    "PLEASE": ["HELP ME", "REPEAT", "WAIT A MINUTE", "THANK YOU"],
    "THANK YOU": ["SO MUCH", "YOU ARE WELCOME", "HAVE A GOOD DAY", "SEE YOU LATER"],
    "WELCOME": ["THANK YOU", "MY PLEASURE", "NICE TO MEET YOU"],
    "YES": ["I AGREE", "PLEASE", "THANK YOU", "YES I CAN", "OF COURSE"],
    "NO": ["NO PROBLEM", "THANK YOU", "NOT RIGHT NOW", "I AM SORRY"],
    "STOP": ["PLEASE", "WAIT A MINUTE", "DONT WORRY"],
    "I LOVE YOU": ["SO MUCH", "THANK YOU", "TAKE CARE", "MY FRIEND"],
    "SORRY": ["MY FAULT", "PLEASE FORGIVE ME", "DONT WORRY", "I APOLOGIZE"],
    "EMERGENCY": ["CALL DOCTOR", "PLEASE HELP", "CALL POLICE"],
    "DOCTOR": ["PLEASE HELP", "I NEED DOCTOR", "EMERGENCY"],
    "FOOD": ["PLEASE", "I AM HUNGRY", "THANK YOU"],
}

SENTENCE_STARTERS = {
    "A": ["ARE YOU OKAY", "ARE WE THERE YET"],
    "B": ["BE CAREFUL", "BACK IN A MINUTE"],
    "C": ["CAN YOU HELP ME", "CALL ME LATER"],
    "D": ["DO YOU UNDERSTAND", "DONT WORRY"],
    "E": ["EXCUSE ME", "EMERGENCY"],
    "F": ["FORGIVE ME", "FEEL BETTER SOON"],
    "G": ["GOOD MORNING", "GOOD NIGHT", "GREAT TO SEE YOU"],
    "H": ["HOW ARE YOU", "HAVE A GOOD DAY", "HELLO", "HELP"],
    "I": ["I AM FINE", "I NEED HELP", "I LOVE YOU", "I DO NOT UNDERSTAND", "I AM SORRY"],
    "J": ["JUST A MINUTE", "JUST KIDDING"],
    "K": ["KEEP IN TOUCH"],
    "L": ["LET ME KNOW", "LOOK OUT"],
    "M": ["MAYBE LATER", "MY NAME IS"],
    "N": ["NICE TO MEET YOU", "NOT RIGHT NOW"],
    "O": ["OH I SEE", "OF COURSE"],
    "P": ["PLEASE REPEAT", "PLEASE WAIT"],
    "Q": ["QUICK QUESTION"],
    "R": ["RIGHT NOW", "READY TO GO"],
    "S": ["SEE YOU LATER", "SOUNDS GOOD", "SORRY ABOUT THAT"],
    "T": ["THANK YOU SO MUCH", "TAKE CARE", "THAT IS AWESOME"],
    "U": ["UNDERSTAND NOW"],
    "V": ["VERY GOOD"],
    "W": ["WHAT IS YOUR NAME", "WHERE ARE YOU", "WAIT A MINUTE", "WHAT HAPPENED"],
    "X": ["XYLOPHONE SOUNDS GREAT"],
    "Y": ["YOU ARE WELCOME", "YES I CAN", "YOU LOOK GREAT", "YOUR TURN"],
    "Z": ["ZERO PROBLEMS"],
}

DEFAULT_CONVERSATION_STARTERS = [
    "HELLO", "HOW ARE YOU", "NICE TO MEET YOU", "I NEED HELP"
]


def get_sentence_suggestions(current_text, last_token=None, limit=4):
    """
    Return up to `limit` full sentence or follow-up suggestions.
    Prioritizes:
      1. Prefix match on current_text being signed/typed (e.g. 'H' -> 'HOW ARE YOU')
      2. Follow-up suggestions for the last recognized gesture/word (e.g. 'HELLO' -> 'HOW ARE YOU')
      3. Fallback to conversation starters if idle
    """
    suggestions = []

    text = str(current_text or "").upper().strip()
    last = str(last_token or "").upper().strip()

    # 1. If actively spelling a word / prefix
    if text:
        first_letter = text[0]
        if first_letter in SENTENCE_STARTERS:
            for s in SENTENCE_STARTERS[first_letter]:
                if s.startswith(text) and s != text and s not in suggestions:
                    suggestions.append(s)

        for w in AUTOCOMPLETE_WORDS:
            if " " in w and w.startswith(text) and w != text and w not in suggestions:
                suggestions.append(w)

        if len(suggestions) >= limit:
            return suggestions[:limit]

    # 2. Contextual follow-up suggestions based on last completed word/gesture
    if last:
        # Direct gesture follow-up table
        if last in GESTURE_FOLLOWUPS:
            for follow in GESTURE_FOLLOWUPS[last]:
                if follow not in suggestions:
                    suggestions.append(follow)

        # Partial match in follow-ups
        for key, follows in GESTURE_FOLLOWUPS.items():
            if (key in last or last in key) and key != last:
                for follow in follows:
                    if follow not in suggestions:
                        suggestions.append(follow)

        # Starters for first letter of last word
        if len(suggestions) < limit and last[0] in SENTENCE_STARTERS:
            for s in SENTENCE_STARTERS[last[0]]:
                if s != last and s not in suggestions:
                    suggestions.append(s)

    # 3. Fallback to popular conversation starters if still empty
    if not suggestions:
        for starter in DEFAULT_CONVERSATION_STARTERS:
            if starter != text and starter != last and starter not in suggestions:
                suggestions.append(starter)

    return suggestions[:limit]
