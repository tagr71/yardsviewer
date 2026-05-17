import type { ComponentType } from "react";
import { ParticipantsDashboard } from "./ParticipantsDashboard";
import { LeaderboardDashboard } from "./LeaderboardDashboard";
import { TimerDashboard } from "./TimerDashboard";
import { TimerSetupDashboard } from "./TimerSetupDashboard";

export type DashboardProps = { eventId: string; eventName?: string; eventLocation?: string };

export type Dashboard = {
  id: string;
  title: string;
  component: ComponentType<DashboardProps>;
};

export const dashboards: Dashboard[] = [
  {
    id: "timer-setup",
    title: "Settings",
    component: TimerSetupDashboard,
  },
  {
    id: "participants",
    title: "Overview",
    component: ParticipantsDashboard,
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    component: LeaderboardDashboard,
  },
  {
    id: "timer",
    title: "Dashboard",
    component: TimerDashboard,
  },
];
