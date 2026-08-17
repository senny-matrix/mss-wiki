import { WikiCard } from "@/components/wiki-card";
import { getArticles } from "@/lib/data/articles";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
  });
}

function summarize(content: string) {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
}

export default async function Home() {
  const articles = await getArticles();

  return (
    <div>
      <main className="max-w-2xl mx-auto mt-10 flex flex-col gap-6">
        {articles.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground">
            No articles yet.
          </p>
        ) : (
          articles.map((article) => (
            <WikiCard
              key={article.id}
              title={article.title}
              author={article.author ?? "Unknown"}
              date={formatDate(article.createdAt)}
              summary={summarize(article.content)}
              href={`/wiki/${article.id}`}
            />
          ))
        )}
      </main>
    </div>
  );
}
