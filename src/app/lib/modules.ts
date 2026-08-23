/**
 * The four decision areas the client asked for (Attendance · Centres · Assessment & Monitoring ·
 * Students) and the questions under each. This is the content behind the chat's opening screen:
 * pick an area → pick a question → the existing answer pipeline runs it.
 *
 * `q` is sent VERBATIM to the AI, so each string is phrased the way the engine answers best.
 * `mode: "preview"` marks a question that depends on data only present in the Preview dataset
 * (the monthly series, the recency/ghost signals) — hidden in Real mode, exactly like the
 * quick prompts. UI chrome is bilingual; the prompts themselves stay English, matching the
 * existing QUICK_PROMPTS behaviour.
 */

export type ModuleId = "attendance" | "centres" | "assessment" | "students";
export type QuestionChip = "threshold" | "forecast" | "correlation" | "risk";

export interface ModuleQuestion {
  /** The exact prompt sent to the AI. */
  q: string;
  /** Small honest badge — flags a threshold check, a projection, or a relationship. */
  chip?: QuestionChip;
  /** Preview-only AND hidden in Real — the data simply is not there. */
  mode?: "preview";
  /** Visible in BOTH modes but only answerable in Preview. Real mode returns an honest explanation
   *  of why no forecast exists, so the user learns the limit instead of the question vanishing. */
  previewOnly?: boolean;
}

export interface DataModule {
  id: ModuleId;
  name: string;
  nameBn: string;
  /** One line under the heading — what this area is for. */
  short: string;
  shortBn: string;
  /** The launcher card's paragraph — what you can decide with it. */
  why: string;
  whyBn: string;
  /** Tint + ink, drawn from the product palette. */
  tint: string;
  ink: string;
  questions: ModuleQuestion[];
}

export const MODULES: DataModule[] = [
  {
    id: "attendance",
    name: "Attendance",
    nameBn: "উপস্থিতি",
    short: "Where children are slipping away",
    shortBn: "যেখানে শিশুরা ঝরে পড়ছে",
    why: "Track who is turning up, spot the centres and areas falling below the line, and see the reasons behind it before children stop coming altogether.",
    whyBn: "কারা উপস্থিত হচ্ছে তা দেখুন, কোন কেন্দ্র ও এলাকা নির্ধারিত সীমার নিচে তা চিহ্নিত করুন, এবং শিশুরা পুরোপুরি আসা বন্ধ করার আগেই কারণ জানুন।",
    tint: "#EEF0FE",
    ink: "#5648d6",
    questions: [
      { q: "Which centres have attendance below 85%?", chip: "threshold" },
      { q: "Show centre-wise total attendance" },
      { q: "Show average attendance by division and programme" },
      { q: "Why is attendance low — what are the reasons?" },
      { q: "Show attendance trend month by month", mode: "preview" },
      { q: "Which low-attendance centres also show economic pressure?", chip: "risk" },
      { q: "Which centres are at rising risk of low attendance?", chip: "forecast", previewOnly: true },
    ],
  },
  {
    id: "centres",
    name: "Centres",
    nameBn: "কেন্দ্র",
    short: "Who to visit, who to learn from",
    shortBn: "কোথায় যেতে হবে, কার কাছ থেকে শিখতে হবে",
    why: "Rank every centre on its monitoring indicators, so you know where to send support this week and which centres are worth copying.",
    whyBn: "প্রতিটি কেন্দ্রকে তার মনিটরিং সূচক অনুযায়ী সাজান — এই সপ্তাহে কোথায় সহায়তা পাঠাবেন এবং কোন কেন্দ্র অনুসরণযোগ্য তা জানুন।",
    tint: "#E7F8F1",
    ink: "#12A97B",
    questions: [
      { q: "Which centers have the lowest score?" },
      { q: "Which centres have the highest monitoring score?" },
      { q: "Which monitoring indicator scored lowest across centres?" },
      { q: "Compare centres across all five monitoring indicators" },
      { q: "Which centres are most likely to be worst next month?", chip: "forecast", mode: "preview" },
    ],
  },
  {
    id: "assessment",
    name: "Assessment & Monitoring",
    nameBn: "মূল্যায়ন ও পর্যবেক্ষণ",
    short: "Whether children are actually learning",
    shortBn: "শিশুরা প্রকৃতপক্ষে শিখছে কি না",
    why: "Read results by area, centre and subject — and see plainly where there is too little assessment data to draw a conclusion.",
    whyBn: "এলাকা, কেন্দ্র ও বিষয় অনুযায়ী ফলাফল দেখুন — এবং কোথায় সিদ্ধান্ত নেওয়ার মতো যথেষ্ট তথ্য নেই তা স্পষ্টভাবে জানুন।",
    tint: "#FFF1E3",
    ink: "#D9812F",
    questions: [
      { q: "Show average marks by division" },
      { q: "Show average marks by centre" },
      { q: "Which subjects have the weakest average marks?" },
      { q: "Show average marks by subject and programme" },
      { q: "Which centers' data is too incomplete to trust?" },
      { q: "How many children are at each reading/score level by area?" },
    ],
  },
  {
    id: "students",
    name: "Students",
    nameBn: "শিক্ষার্থী",
    short: "The individual children who need help",
    shortBn: "যে শিশুদের সহায়তা প্রয়োজন",
    why: "Move from the aggregate to the child: who is thriving, who has quietly stopped coming, and how household income relates to both.",
    whyBn: "সামষ্টিক তথ্য থেকে ব্যক্তি শিশুতে যান: কারা ভালো করছে, কারা নীরবে আসা বন্ধ করেছে, এবং পারিবারিক আয়ের সাথে এর সম্পর্ক কী।",
    tint: "#E8F4FE",
    ink: "#1E7FC2",
    questions: [
      { q: "Which students have the highest average marks?" },
      { q: "Show students who are regularly absent", mode: "preview" },
      { q: "Show ghost / inactive students", mode: "preview" },
      { q: "Show dropout reasons by income band" },
      { q: "Is there a relationship between family income and attendance?", chip: "correlation" },
      { q: "Show dropout risk — the highest-risk students" },
    ],
  },
];

/** Badge copy — kept next to the data so a new chip can't be added without labelling it. */
export const CHIP_LABEL: Record<QuestionChip, { text: string; bg: string; fg: string }> = {
  threshold:   { text: "Threshold",   bg: "#FFECEF", fg: "#D33049" },
  risk:        { text: "Risk",        bg: "#FFECEF", fg: "#D33049" },
  forecast:    { text: "Forecast",    bg: "#EEF0FE", fg: "#5648d6" },
  correlation: { text: "Correlation", bg: "#EEF0FE", fg: "#5648d6" },
};
