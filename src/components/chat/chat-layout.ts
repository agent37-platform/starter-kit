"use client";

import { useSyncExternalStore } from "react";

// How an expert's chat sits on a wide screen (Leslie, 25/10): its column of conversations shown or
// hidden (remembered in this browser), and the chat spread over the whole window, menu and header
// included, until « Réduire » or Échap. Shared by the workspace that lays the page out and the chat
// header that holds the buttons.

const LIST_KEY = "yelema.chat.list-hidden";
const PROFILE_KEY = "yelema.chat.profile-panel";

let listHidden = false;
let profileOpen = false;
let profileHere = false;
let full = false;
let sidePanel = false;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    listHidden = localStorage.getItem(LIST_KEY) === "1";
    profileOpen = localStorage.getItem(PROFILE_KEY) === "1";
  } catch {
    // Stockage indisponible : la colonne reste affichée.
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function setChatListHidden(hidden: boolean) {
  listHidden = hidden;
  try {
    localStorage.setItem(LIST_KEY, hidden ? "1" : "0");
  } catch {
    // Le choix ne survivra pas au rechargement.
  }
  emit();
}

export function setChatFull(on: boolean) {
  full = on;
  emit();
}

// Son ordinateur or Tableau de bord open beside the chat: the column of conversations folds away
// meanwhile (not remembered), so the chat keeps room to be read.
export function setChatSidePanel(open: boolean) {
  if (sidePanel === open) return;
  sidePanel = open;
  emit();
}

// The expert's profile beside its chat (Myriel's choice A, Leslie 18/11): closed at first, then as the
// member left it (remembered in this browser). Open, it folds the column of conversations like the others.
export function setProfilePanel(open: boolean) {
  if (profileOpen === open) return;
  profileOpen = open;
  try {
    localStorage.setItem(PROFILE_KEY, open ? "1" : "0");
  } catch {
    // Le choix ne survivra pas au rechargement.
  }
  emit();
}

export function useProfilePanel(): boolean {
  return useSyncExternalStore(subscribe, () => (load(), profileOpen), () => false);
}

/** The page has a profile panel (an expert's chat): only there does an open one fold the conversations. */
export function setProfilePanelHere(here: boolean) {
  if (profileHere === here) return;
  profileHere = here;
  emit();
}

/** A panel is open beside the chat (Son ordinateur, Tableau de bord or the profile). */
export function useChatSidePanel(): boolean {
  return useSyncExternalStore(subscribe, () => (load(), sidePanel || (profileOpen && profileHere)), () => false);
}

export function useChatListHidden(): boolean {
  return useSyncExternalStore(subscribe, () => (load(), listHidden), () => false);
}

export function useChatFull(): boolean {
  return useSyncExternalStore(subscribe, () => full, () => false);
}
