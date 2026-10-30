// Portfolio tour: the Expert Operator fixes several sites one after another.
// The map hands over a queue of 3D pages; each page fixes its site, adds its
// action plan and opens the next; back on the map, one combined plan.
import { readSession, writeSession } from "./session.js";

const KEY = "tour";

export const readTour = () => readSession(KEY);
export const endTour = () => { try { sessionStorage.removeItem(`sitetwin:${KEY}`); } catch { /* storage off */ } };

// `stops`: [{ site_id, url }] in the order to visit; `back`: the map page to return to.
export function startTour(stops, back) {
  writeSession(KEY, { stops, back, plans: [], total: stops.length });
}

// Called by a 3D page when its site is done: keeps the plan, returns where to go next.
export function finishStop(siteId, plan) {
  const tour = readTour();
  if (!tour) return null;
  if (plan) tour.plans.push(plan);
  tour.stops = tour.stops.filter((s) => s.site_id !== siteId);
  writeSession(KEY, tour);
  return tour.stops[0]?.url ?? tour.back;
}

export function progress(siteId) {
  const tour = readTour();
  if (!tour?.stops.some((s) => s.site_id === siteId)) return null;
  return { done: tour.total - tour.stops.length + 1, total: tour.total };
}
