/** Irregular past participles, for spotting "was written", "is known", "were taken". */
export const IRREGULAR_PARTICIPLES: string[] = [
	"done", "made", "given", "taken", "seen", "written", "known", "shown", "built", "sent", "held", "kept", "told",
	"found", "brought", "bought", "thought", "caught", "taught", "left", "paid", "said", "put", "begun", "broken",
	"chosen", "driven", "eaten", "fallen", "forgotten", "forgiven", "frozen", "gotten", "hidden", "ridden",
	"shaken", "spoken", "stolen", "sworn", "torn", "worn", "beaten", "bitten", "blown", "drawn", "flown", "grown",
	"thrown", "sung", "spun", "struck", "hung", "led", "meant", "heard", "sold", "understood", "won", "felt",
	"fed", "bound", "dealt", "laid", "overtaken", "undertaken", "withdrawn", "forbidden", "proven", "overseen",
	"rewritten", "rebuilt",
];

/**
 * Words that look like past participles after "is" or "was" but read as
 * adjectives ("I was tired", "she is interested") or are not verbs at all.
 */
export const ADJECTIVE_PARTICIPLES: string[] = [
	"tired", "interested", "excited", "worried", "bored", "pleased", "surprised", "scared", "frightened",
	"married", "divorced", "supposed", "concerned", "involved", "related", "unrelated", "determined",
	"convinced", "satisfied", "disappointed", "frustrated", "confused", "embarrassed", "exhausted", "amazed",
	"annoyed", "ashamed", "committed", "dedicated", "devoted", "engaged", "crowded", "complicated", "detailed",
	"advanced", "experienced", "qualified", "skilled", "talented", "gifted", "limited", "sophisticated", "mixed",
	"focused", "obsessed", "stressed", "relaxed", "delighted", "thrilled", "overwhelmed", "impressed", "shocked",
	"terrified", "horrified", "puzzled", "motivated", "prepared", "located", "situated", "closed", "biased",
	"dated", "outdated", "renowned", "unemployed", "unexpected", "unprecedented", "undecided", "unfinished",
	"indeed", "naked", "wicked", "sacred", "rugged", "crooked", "beloved", "aged", "blessed", "wretched",
	"hundred", "kindred", "hatred", "need", "seed", "speed", "feed", "greed", "deed", "weed", "bleed", "breed",
	"shed", "proceed", "succeed", "exceed", "embed",
];
