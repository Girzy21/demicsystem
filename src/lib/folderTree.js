// Topik bawaan per subject. Dipindahkan dari Homepage.jsx supaya Homepage, panel admin, dan server memakai daftar yang sama.
// Folder tree: Subject → Topic. This is the primary organizing structure —
// browsing feels like a file manager, not a filtered flat list.
//
// CAS (Creativity, Activity, Service) is an IB DP core component, not a
// subject with a syllabus — its "topics" are the three CAS strands plus the
// CAS Project.
export const FOLDER_TREE = {
  Physics: ["Mechanics", "Waves & Oscillation", "Thermal Physics", "Electricity & Magnetism"],
  Chemistry: ["Organic Chemistry", "Atomic Structure", "Equilibrium", "Acids & Bases"],
  // Math AA and Math AI used to be separate subjects (mirroring the IB's
  // "Analysis & Approaches" / "Applications & Interpretation" split). Merged
  // into one Math folder per explicit requirement — the SL/HL-style route
  // distinction isn't tracked anymore, just the topic itself. Topic list is
  // the union of both former lists, de-duplicated.
  Math: ["Calculus", "Algebra", "Statistics & Probability", "Geometry & Trigonometry", "Modelling"],
  Biology: ["Cell Biology", "Genetics", "Ecology", "Human Physiology"],
  Economics: ["Microeconomics", "Macroeconomics", "International Trade"],
  "Business Mgmt": ["Marketing", "Finance & Accounts", "Human Resources"],
  // Was "English Lit" — merged/renamed to plain "English" per explicit requirement.
  English: ["Poetry Analysis", "Prose Fiction", "Paper 2 Comparative"],
  History: ["Cold War", "Authoritarian States", "Independence Movements"],
  TOK: ["Knowledge Questions", "Essay Prep", "Exhibition"],
  CAS: ["Creativity", "Activity", "Service", "CAS Project"],
};
