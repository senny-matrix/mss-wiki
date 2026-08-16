import WikiEditor from "@/components/wiki-editor";
import { hexclaveServerApp } from "@/hexclave/server";
import { redirect } from "next/navigation";

export default async function NewArticlePage() {
  const user = await hexclaveServerApp.getUser();
  if (!user) {
    redirect("/handler/sign-in");
  }
  return <WikiEditor isEditing={false} />;
}
