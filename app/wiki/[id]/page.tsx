import { notFound } from "next/navigation";
import WikiArticleViewer from "@/components/wiki-article-viewer";
import { getArticleById } from "@/lib/data/articles";

interface ViewArticlePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ViewArticlePage({
  params,
}: ViewArticlePageProps) {
  const { id } = await params;
  const article = await getArticleById(Number(id));

  if (!article) {
    notFound();
  }

  // Permission check - in a real app, this would come from auth/user context
  const canEdit = true;

  return <WikiArticleViewer article={article} canEdit={canEdit} />;
}
