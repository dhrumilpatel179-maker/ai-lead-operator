import { LeadOperatorDashboard } from "../components/lead-operator-dashboard";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <LeadOperatorDashboard currentUser={{ displayName: user.displayName, email: user.email }} />;
}
