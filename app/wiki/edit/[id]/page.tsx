import { notFound, redirect } from "next/navigation";
import WikiEditor from "@/components/wiki-editor";
import { hexclaveServerApp } from "@/hexclave/server";
import { getArticleById } from "@/lib/data/articles";

interface EditArticlePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EditArticlePage({
  params,
}: EditArticlePageProps) {
  const user = await hexclaveServerApp.getUser();
  if (!user) {
    redirect("/handler/sign-in");
  }

  const { id } = await params;
  const article = await getArticleById(Number(id));

  if (!article) {
    notFound();
  }

  return (
    <WikiEditor
      initialTitle={article.title}
      initialContent={article.content}
      isEditing={true}
      articleId={id}
    />
  );
}
