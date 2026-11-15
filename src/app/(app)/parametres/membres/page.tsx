import { MembersPage } from "@/components/MembersPage";
import { initialMembers } from "@/lib/first-screen-server";

export default async function Page() {
  return <MembersPage initial={await initialMembers()} />;
}
