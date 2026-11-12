import { Stack } from "expo-router";
import { color } from "@/theme/tokens";

export default function PeopleLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, animation: "slide_from_right" }} />;
}
