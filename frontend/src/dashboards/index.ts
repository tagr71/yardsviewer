import type { ComponentType } from "react";
import { Overview } from "./Overview";
import { Leaderboard } from "./Leaderboard";
import { Dashboard as DashboardView } from "./Dashboard";
import { Settings } from "./Settings";
import { Jerseys } from "./Jerseys";

export type DashboardProps = { eventId: string; eventName?: string; eventLocation?: string };

export type Dashboard = {
  id: string;
  title: string;
  component: ComponentType<DashboardProps>;
};

export const dashboards: Dashboard[] = [
  {
    id: "settings",
    title: "Settings",
    component: Settings,
  },
  {
    id: "overview",
    title: "Overview",
    component: Overview,
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    component: Leaderboard,
  },
  {
    id: "dashboard",
    title: "Dashboard",
    component: DashboardView,
  },
  {
    id: "jerseys",
    title: "Jerseys",
    component: Jerseys,
  },
];
