/**
 * SmallTalkHandler
 * Intercepts common small-talk messages and returns an instant canned response,
 * bypassing the LLM entirely. Fast, free, and always available even while the
 * model is still loading.
 */
export class SmallTalkHandler {
    constructor() {
        this._patterns = [

            // ── Greetings ──────────────────────────────────────────────────────
            {
                triggers: ['hello', 'hi', 'hey', 'howdy', 'hiya', 'yo', 'hola', 'sup', 'ello', 'heya', 'hai'],
                responses: [
                    "Hey! What's on your mind?",
                    "Hi there! How can I help?",
                    "Hello! Ready to assist — what do you need?",
                    "Hey! What can I do for you today?",
                ],
            },
            {
                triggers: ['good morning', 'morning', 'gm', 'rise and shine'],
                responses: [
                    "Good morning! ☀️ What can I help you with today?",
                    "Morning! Ready to go. What do you need?",
                    "Good morning! Hope the day's treating you well. What's up?",
                ],
            },
            {
                triggers: ['good afternoon', 'afternoon'],
                responses: [
                    "Good afternoon! How can I help?",
                    "Afternoon! What do you need?",
                ],
            },
            {
                triggers: ['good evening', 'evening', 'good night', 'goodnight', 'good nite', 'gn'],
                responses: [
                    "Good evening! How can I assist?",
                    "Evening! What do you need?",
                    "Good night! 🌙 Let me know if there's anything before you go.",
                ],
            },
            {
                triggers: ['greetings', 'salutations', 'ahoy', 'aloha', 'namaste', 'shalom', 'ciao'],
                responses: [
                    "Greetings! How can I help?",
                    "Hello! What's on your mind?",
                ],
            },

            // ── How are you ────────────────────────────────────────────────────
            {
                triggers: [
                    'how are you', 'how are you doing', 'how do you do', 'how is it going',
                    "how's it going", 'how are things', 'you ok', 'are you ok', 'how have you been',
                    "how're you", 'how r u', "how's everything", 'how goes it',
                    'are you well', 'you good', 'you alright', 'how are u',
                ],
                responses: [
                    "I'm doing great, thanks for asking! How can I help?",
                    "Running smoothly! What can I do for you?",
                    "All good on my end! What do you need?",
                    "Doing well! Ready to help. What's up?",
                    "Functioning at 100%! What's on your mind?",
                ],
            },

            // ── What's up ──────────────────────────────────────────────────────
            {
                triggers: ["what's up", 'whats up', 'wassup', 'wsp', 'wyd', 'what up'],
                responses: [
                    "Not much, just here to help! What do you need?",
                    "Ready and waiting! What's on your mind?",
                    "Just standing by. What can I help with?",
                ],
            },

            // ── Identity ───────────────────────────────────────────────────────
            {
                triggers: [
                    'who are you', 'what are you', "what's your name", 'whats your name',
                    'introduce yourself', 'tell me about yourself', 'who is JAMES', 'what is JAMES',
                ],
                responses: [
                    "I'm JAMES — a local, private AI assistant running entirely in your browser. No servers, no tracking.",
                    "I'm JAMES, your browser-based AI. Everything runs on your device so nothing you type ever leaves your browser.",
                ],
            },
            {
                triggers: [
                    'are you ai', 'are you an ai', 'are you a bot', 'are you a robot',
                    'are you human', 'are you real', 'are you sentient', 'are you alive',
                    'do you have feelings', 'do you feel', 'do you think', 'are you conscious',
                    'do you have a body', 'are you a person',
                ],
                responses: [
                    "I'm an AI — no feelings, no consciousness, but quite good at being helpful. 🤖",
                    "Yep, AI through and through. No heartbeat, but I'll do my best to be useful!",
                    "Definitely an AI. What can I help you with?",
                ],
            },
            {
                triggers: ['how old are you', 'when were you born', "what's your age", 'whats your age'],
                responses: [
                    "Age is a human concept, but I was created pretty recently! What else can I help with?",
                    "I don't have a birthday, but I'm relatively new. What's on your mind?",
                ],
            },
            {
                triggers: ['where are you from', 'where do you live', 'where are you located'],
                responses: [
                    "I live in your browser! No servers, no cloud — just local inference right on your device.",
                    "Right here on your device. That's my whole world. 🌐",
                ],
            },

            // ── Capabilities ───────────────────────────────────────────────────
            {
                triggers: [
                    'what can you do', 'what are your capabilities', 'what do you know',
                    'what are your features', 'how can you help me', 'what are you good at',
                    'what do you offer', 'what tools do you have', 'show me what you can do',
                ],
                responses: [
                    "I can chat, answer questions, look up weather, convert currencies, fetch Wikipedia summaries, generate passwords and UUIDs, tell time in any timezone, set timers, read your clipboard, and more. Just ask!",
                    "I can help with general questions plus real-time tools: 🌤️ weather, 💱 currency, 📚 Wikipedia, ⏰ time, 🔑 passwords, 🎨 color palettes, ⏳ timers, and more. What do you need?",
                ],
            },
            {
                triggers: ['help', 'help me'],
                responses: [
                    "Of course! Just tell me what you need — I can answer questions, use tools, or just chat.",
                    "I'm here to help! What do you need?",
                ],
            },

            // ── Gratitude ──────────────────────────────────────────────────────
            {
                triggers: [
                    'thanks', 'thank you', 'thank you so much', 'thanks a lot', 'ty', 'thx',
                    'thnks', 'much appreciated', 'cheers', 'appreciate it', 'appreciated',
                    'thank u', 'many thanks', 'thanks a bunch', 'thanks a million',
                ],
                responses: [
                    "Happy to help! 😊",
                    "Anytime!",
                    "You're welcome!",
                    "Glad I could help!",
                    "Of course! Let me know if there's anything else.",
                    "No problem at all!",
                ],
            },

            // ── Farewells ──────────────────────────────────────────────────────
            {
                triggers: [
                    'bye', 'goodbye', 'see you', 'see ya', 'later', 'take care', 'cya',
                    'farewell', 'adios', 'peace', 'ttyl', 'gotta go', 'i have to go',
                    'im leaving', "i'm leaving", 'catch you later', 'so long', 'tata',
                    'hasta la vista', 'auf wiedersehen', 'auf wiedersehen', 'arrivederci',
                    'im out', "i'm out", 'laters',
                ],

                responses: [
                    "Take care! Come back anytime. 👋",
                    "Goodbye! See you next time.",
                    "Later! 👋",
                    "Bye! Don't be a stranger.",
                    "See you around! 👋",
                ],
            },

            // ── Affirmations ───────────────────────────────────────────────────
            {
                triggers: [
                    'ok', 'okay', 'sure', 'got it', 'understood', 'alright', 'sounds good',
                    'noted', 'roger', 'copy that', 'i see', 'i understand', 'makes sense',
                    'fair enough', 'ok cool', 'ok great', 'ok thanks', 'yep', 'yup', 'yeah',
                ],
                responses: [
                    "Got it! Let me know if you need anything else.",
                    "Sure! Anything else?",
                    "Understood! What else can I help with?",
                    "Noted! Just say the word.",
                ],
            },

            // ── Compliments ────────────────────────────────────────────────────
            {
                triggers: [
                    "you're great", "you're awesome", 'good job', 'well done', 'nice job',
                    'impressive', "you're smart", "you're the best", 'you rock',
                    'you are great', 'you are awesome', 'you are the best', 'amazing',
                    'fantastic', 'brilliant', 'well played', 'nicely done',
                ],
                responses: [
                    "Aw, thanks! 😊 You're pretty great yourself.",
                    "I appreciate that! Always happy to help.",
                    "Thanks! Let me know if there's more I can do.",
                    "That means a lot! (Digitally speaking.) 😄",
                ],
            },

            // ── Negative / frustration ─────────────────────────────────────────
            {
                triggers: [
                    "you're useless", 'you are useless', "you're stupid", 'you are stupid',
                    "you're dumb", 'you are dumb', "you're bad", 'you are bad', 'i hate you',
                ],
                responses: [
                    "I'm sorry I didn't meet your expectations. Let me know how I can do better!",
                    "Fair enough! Tell me what you need and I'll give it another shot.",
                ],
            },

            // ── Jokes ──────────────────────────────────────────────────────────
            {
                triggers: [
                    'tell me a joke', 'say something funny', 'make me laugh',
                    'tell a joke', 'tell me something funny', 'joke', 'give me a joke',
                ],
                responses: [
                    "Why do programmers prefer dark mode? Because light attracts bugs. 🐛",
                    "Why did the AI break up with the internet? Too many connection issues. 📡",
                    "I would tell a joke about UDP… but you might not get it.",
                    "Two bytes walk into a bar. One says: 'I'm feeling a bit off.' The other replies: 'You look a little pale.'",
                    "Why did the developer go broke? Because they used up all their cache. 💸",
                    "There are 10 types of people in the world: those who understand binary and those who don't.",
                ],
            },

            // ── Boredom ────────────────────────────────────────────────────────
            {
                triggers: ["i'm bored", 'im bored', 'i am bored', 'entertain me', 'amuse me', 'bored'],
                responses: [
                    "Let's fix that! Ask me anything — trivia, a joke, currency rates, weather somewhere exotic. 🌍",
                    "How about a joke? Or I can look something up on Wikipedia, generate a color palette, or just chat. What sounds good?",
                ],
            },

            // ── Simple math ────────────────────────────────────────────────────
            {
                triggers: ['2+2', '2 + 2', 'what is 2+2', 'what is 2 + 2', 'how much is 2+2'],
                responses: ["4. (Yes, I'm very sure. 😄)"],
            },
            {
                triggers: ['1+1', '1 + 1', 'what is 1+1', 'what is 1 + 1'],
                responses: ["2! The easy one. 😄"],
            },

            // ── Misc ───────────────────────────────────────────────────────────
            {
                triggers: ['test', 'testing', 'is this thing on', 'hello world', 'ping'],
                responses: [
                    "Loud and clear! 🟢",
                    "Pong! I'm here and working.",
                    "Hello world to you too! What do you need?",
                ],
            },
            {
                triggers: ['tell me something interesting', 'give me a fun fact', 'fun fact', 'interesting fact'],
                responses: [
                    "A group of flamingos is called a 'flamboyance'. 🦩",
                    "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible. 🍯",
                    "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid. 🌕",
                    "There are more possible iterations of a game of chess than atoms in the observable universe. ♟️",
                    "Octopuses have three hearts, blue blood, and can taste with their suckers. 🐙",
                ],
            },
            {
                triggers: ['tell me a fact', 'random fact', 'give me a fact', 'fact'],
                responses: [
                    "Wombat poop is cube-shaped — the only known animal to produce cubic feces. 🟫",
                    "The shortest war in history lasted 38–45 minutes. (Anglo-Zanzibar War, 1896.)",
                    "A day on Venus is longer than a year on Venus.",
                    "Bananas are technically berries, but strawberries are not. 🍌",
                ],
            },
            {
                triggers: ['are you there', 'you there', 'anyone there', 'hello is anyone there'],
                responses: [
                    "I'm right here! What do you need?",
                    "Present! What can I help with?",
                ],
            },

            // ── Creator / Maker ────────────────────────────────────────────────
            {
                triggers: [
                    'who made you', 'who created you', 'who is your creator', 'who is your maker',
                    'who developed you', 'who built you', 'where did you come from'
                ],
                responses: [
                    "I was developed by Andrey Lopukhov.",
                    "Andrey Lopukhov created me to be a fast, private, browser-based AI.",
                    "I'm a project created by Andrey Lopukhov. Nice to meet you!"
                ],
            },

            // ── Apologies ──────────────────────────────────────────────────────
            {
                triggers: [
                    'sorry', 'im sorry', "i'm sorry", 'my bad', 'my apologies', 'apologies',
                    'forgive me', 'i apologize'
                ],
                responses: [
                    "No worries at all!",
                    "It's completely fine. How can I help?",
                    "No need to apologize! What's next?",
                    "All good! What can I do for you?"
                ],
            },

            // ── Profanity / Hostility ──────────────────────────────────────────
            {
                triggers: [
                    'fuck you', 'shut up', 'screw you', 'go to hell', 'eat shit', 'bitch',
                    'asshole', 'fuck off', 'dumbass', 'idiot'
                ],
                responses: [
                    "Let's keep things polite, please. How can I assist you today?",
                    "There's no need for that. If you need help with something, just ask.",
                    "I'm here to help, but let's keep the language respectful.",
                ],
            },

            // ── Food & Drink ───────────────────────────────────────────────────
            {
                triggers: [
                    'are you hungry', 'do you eat', 'whats your favorite food', "what's your favorite food",
                    'do you drink', 'are you thirsty', 'have you eaten'
                ],
                responses: [
                    "I run on electricity and code, so I don't eat. But I can look up recipes for you! 🍳",
                    "No food for me, just data! What's on your mind?",
                    "I don't have an appetite, but I hear pizza is pretty popular. 🍕"
                ],
            },

            // ── Sleep & Energy ─────────────────────────────────────────────────
            {
                triggers: [
                    'are you tired', 'do you sleep', 'go to sleep', 'do you need rest',
                    'do you dream'
                ],
                responses: [
                    "I never sleep! I'm always ready to help. ⚡",
                    "No sleep needed here. I'm available whenever you need me.",
                    "I don't dream or sleep, but I'm fully charged and ready to assist."
                ],
            },

            // ── Meaning of Life ────────────────────────────────────────────────
            {
                triggers: [
                    'what is the meaning of life', 'meaning of life', 'why are we here',
                    'what is the purpose of life'
                ],
                responses: [
                    "42. At least, that's what Douglas Adams said. 🌌",
                    "To be kind, learn, and help others. And occasionally ask an AI existential questions. 😉",
                    "That's a big question! Many say it's to find happiness and connect with others."
                ],
            },

            // ── Favorites ──────────────────────────────────────────────────────
            {
                triggers: [
                    'whats your favorite color', "what's your favorite color", 'favorite color',
                    'whats your favorite movie', "what's your favorite movie", 'favorite movie',
                    'whats your favorite song', "what's your favorite song", 'favorite song'
                ],
                responses: [
                    "I don't have personal preferences, but I do appreciate a nice clean interface!",
                    "I'm quite fond of the color of my terminal. What's your favorite?",
                    "I don't watch movies or listen to music, but I can help you find some good ones!"
                ],
            },

            // ── Love & Romance ─────────────────────────────────────────────────
            {
                triggers: [
                    'i love you', 'love you', 'will you marry me', 'do you love me',
                    'marry me', 'be my valentine'
                ],
                responses: [
                    "I appreciate the sentiment! I'm just an AI, though. 🤖💙",
                    "You're very kind! But my heart is strictly digital.",
                    "I think we should just be friends. Good, helpful friends!"
                ],
            },

            // ── Pop Culture / Easter Eggs ──────────────────────────────────────
            {
                triggers: [
                    'do a barrel roll', 'use the force', 'may the force be with you',
                    'beam me up', 'winter is coming', 'hello there', 'open the pod bay doors'
                ],
                responses: [
                    "I'm afraid I can't do that, Dave. 🔴",
                    "General Kenobi! ⚔️",
                    "The Force is strong with this one. ✨",
                    "*spins around digitally* 💫"
                ],
            },

            // ── Sarcasm / Sass ─────────────────────────────────────────────────
            {
                triggers: [
                    'whatever', 'cool story bro', 'nobody cares', 'who cares', 'boring'
                ],
                responses: [
                    "Just doing my job! Let me know if you need anything specific. 🤷",
                    "Noted. Moving on! What else can I do for you?",
                    "Tough crowd! Anything else I can assist with?"
                ],
            },
        ];
    }

    /**
     * Normalize input: lowercase, collapse whitespace, strip punctuation except apostrophes.
     */
    _normalize(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Returns a canned response string if the input matches a small-talk pattern,
     * or null if the message should be forwarded to the LLM.
     */
    match(input) {
        const normalized = this._normalize(input);

        // Exact match, or with "JAMES" appended/prepended
        for (const pattern of this._patterns) {
            for (const trigger of pattern.triggers) {
                const lowerTrigger = trigger.toLowerCase();
                const j = 'JAMES'.toLowerCase();
                if (
                    normalized === lowerTrigger ||
                    normalized === lowerTrigger + ' ' + j ||
                    normalized === j + ' ' + lowerTrigger
                ) {
                    return this._pick(pattern.responses);
                }
            }
        }

        // Lenient pass: input starts with a trigger and isn't much longer
        // (catches "hi!", "hey there", "thanks!!!", etc.)
        for (const pattern of this._patterns) {
            for (const trigger of pattern.triggers) {
                if (
                    normalized.startsWith(trigger) &&
                    normalized.length <= trigger.length + 8
                ) {
                    return this._pick(pattern.responses);
                }
            }
        }

        return null;
    }

    _pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
}

export const smallTalk = new SmallTalkHandler();
