/**
 * Common words of four or more letters that carry little meaning on their
 * own. Repeating them is normal, so the repeated-word metric ignores them.
 */
export const STOPWORDS = new Set([
	"about", "above", "across", "after", "again", "against", "almost", "along", "already", "also", "although",
	"always", "among", "another", "anyone", "anything", "around", "away", "back", "because", "become", "becomes",
	"been", "before", "behind", "being", "below", "best", "better", "between", "both", "came", "cannot", "come",
	"comes", "could", "didn't", "does", "doesn't", "doing", "done", "don't", "down", "during", "each", "either",
	"else", "enough", "even", "ever", "every", "everyone", "everything", "first", "from", "gets", "getting", "give",
	"given", "gives", "goes", "going", "good", "great", "had", "hadn't", "hasn't", "have", "haven't", "having",
	"here", "herself", "himself", "into", "isn't", "it's", "itself", "just", "keep", "kind", "know", "last", "less",
	"like", "little", "long", "look", "made", "make", "makes", "many", "might", "more", "most", "much", "must",
	"myself", "need", "needs", "neither", "never", "next", "nothing", "once", "only", "onto", "other", "others",
	"ourselves", "over", "part", "people", "perhaps", "quite", "rather", "really", "said", "same", "says", "seem",
	"seems", "should", "since", "some", "someone", "something", "sometimes", "soon", "still", "such", "take",
	"takes", "than", "that", "that's", "their", "theirs", "them", "themselves", "then", "there", "there's", "these",
	"they", "they're", "thing", "things", "think", "this", "those", "though", "through", "time", "times", "today",
	"together", "too", "toward", "towards", "under", "until", "upon", "very", "want", "wants", "wasn't", "we're",
	"well", "were", "weren't", "what", "what's", "when", "where", "whether", "which", "while", "whom", "whose",
	"will", "with", "within", "without", "won't", "work", "would", "wouldn't", "year", "years", "you're", "your",
	"yours", "yourself",
]);

/**
 * Words ending in -ly that are not -ly adverbs (adjectives, nouns, verbs) or
 * are adverbs nobody would cut ("only", "early").
 */
export const NOT_ADVERBS = new Set([
	"only", "early", "family", "reply", "apply", "supply", "imply", "comply", "rely", "multiply", "ally", "rally",
	"tally", "belly", "jelly", "bully", "folly", "holly", "gully", "dolly", "lily", "hilly", "chilly", "silly",
	"frilly", "smelly", "woolly", "wooly", "holy", "ugly", "oily", "wily", "doily", "curly", "burly", "surly",
	"jolly", "likely", "unlikely", "friendly", "unfriendly", "lovely", "lonely", "lively", "costly", "deadly",
	"elderly", "orderly", "disorderly", "ghostly", "godly", "ungodly", "goodly", "heavenly", "worldly", "earthly",
	"beastly", "cowardly", "scholarly", "motherly", "fatherly", "brotherly", "sisterly", "neighborly",
	"neighbourly", "kingly", "queenly", "princely", "saintly", "stately", "comely", "homely", "manly", "womanly",
	"timely", "untimely", "leisurely", "unruly", "unsightly", "unseemly", "sickly", "prickly", "wrinkly",
	"crinkly", "wobbly", "bubbly", "cuddly", "giggly", "squiggly", "daily", "weekly", "monthly", "yearly",
	"hourly", "nightly", "quarterly", "biweekly", "fortnightly", "northerly", "southerly", "easterly", "westerly",
	"butterfly", "firefly", "dragonfly", "gadfly", "housefly", "anomaly", "assembly", "monopoly", "homily",
	"panoply", "melancholy", "italy", "july", "sicily", "emily", "kelly", "billy", "sally", "molly", "polly",
	"lowly", "shapely", "portly", "courtly", "lordly", "sprightly", "measly", "grisly", "grizzly", "gangly",
	"bodily", "dally", "sully",
]);
