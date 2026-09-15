import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);

/* If the keys are missing the app must still render so it can say so,
   rather than dying on a white screen. A placeholder client keeps every
   call shaped the same; the requests simply fail. */
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder-anon-key"
);

/* ------------------------------------------------------------------
   Reads are public. Writes to questions, materials and settings
   require an authenticated admin — enforced by row level security in
   the database, not by this file.
------------------------------------------------------------------ */

export async function loadBank() {
  const [q, m, s] = await Promise.all([
    supabase.from("questions").select("*").order("created_at", { ascending: true }),
    supabase.from("materials").select("*").order("position", { ascending: true }),
    supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (q.error) throw q.error;
  if (m.error) throw m.error;
  return {
    questions: (q.data || []).map(fromRowQ),
    materials: (m.data || []).map(fromRowM),
    bands: s.data?.bands || null,
  };
}

const fromRowQ = (r) => ({
  id: r.id, subject: r.subject, unit: r.unit, difficulty: r.difficulty,
  stem: r.stem, choices: r.choices, answer: r.answer, explanation: r.explanation,
});
const toRowQ = (q) => ({
  id: q.id, subject: q.subject, unit: q.unit, difficulty: q.difficulty,
  stem: q.stem, choices: q.choices, answer: q.answer, explanation: q.explanation,
});
const fromRowM = (r) => ({
  id: r.id, subject: r.subject, unit: r.unit, kind: r.kind,
  title: r.title, body: r.body || "", url: r.url || "", position: r.position ?? 0,
});
const toRowM = (m) => ({
  id: m.id, subject: m.subject, unit: m.unit, kind: m.kind,
  title: m.title, body: m.body || "", url: m.url || "", position: m.position ?? 0,
});

export async function upsertQuestions(list) {
  const { error } = await supabase.from("questions").upsert(list.map(toRowQ));
  if (error) throw error;
}
export async function deleteQuestion(id) {
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) throw error;
}
export async function upsertMaterial(m) {
  const { error } = await supabase.from("materials").upsert(toRowM(m));
  if (error) throw error;
}
export async function deleteMaterial(id) {
  const { error } = await supabase.from("materials").delete().eq("id", id);
  if (error) throw error;
}
export async function saveBands(bands) {
  const { error } = await supabase.from("settings").upsert({ id: 1, bands });
  if (error) throw error;
}

/* Anyone may record a finished set; only an admin may read them back. */
export async function recordSessionRow(s) {
  const { error } = await supabase.from("sessions").insert({
    subject: s.subject, unit: s.unit, mode: s.mode || "practice",
    total: s.total, correct: s.correct, secs: s.secs, answers: s.answers,
  });
  if (error) throw error;
}
export async function loadSessions(limit = 1000) {
  const { data, error } = await supabase
    .from("sessions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

/* Admin sign in uses Supabase Auth. Create the account once in the
   Supabase dashboard under Authentication → Users. */
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export const signOut = () => supabase.auth.signOut();
export const getSession = () => supabase.auth.getSession();

/* The tutor runs through an edge function so the Anthropic key never
   reaches the browser. If the function is not deployed this throws and
   the UI tells the student the tutor is unavailable. */
export async function askTutor(messages, system, maxTokens = 1200) {
  const { data, error } = await supabase.functions.invoke("tutor", {
    body: { messages, system, max_tokens: maxTokens },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.text || "").trim();
}

/* Per-student progress and theme stay on the student's own device. */
const LS = "equilibrium:me";
export function loadMe() {
  try { return JSON.parse(localStorage.getItem(LS)) || { unit: {}, theme: "dark" }; }
  catch { return { unit: {}, theme: "dark" }; }
}
export function saveMe(me) {
  try { localStorage.setItem(LS, JSON.stringify(me)); } catch { /* private mode */ }
}
