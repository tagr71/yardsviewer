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
    id: "participants",
    title: "Number of participants",
    component: ParticipantsDashboard,
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    component: LeaderboardDashboard,
  },
  {
    id: "timer-setup",
    title: "Timer set-up",
    component: TimerSetupDashboard,
  },
  {
    id: "timer",
    title: "Timer dashboard",
    component: TimerDashboard,
  },
];
