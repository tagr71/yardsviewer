import type { ComponentType } from "react";
import { ParticipantsDashboard } from "./ParticipantsDashboard";
import { LeaderboardDashboard } from "./LeaderboardDashboard";

export type DashboardProps = { eventId: string };

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
];
