import { redirect } from "next/navigation";

export default function SchedulePage() {
  redirect("/tasks?view=schedule");
}
