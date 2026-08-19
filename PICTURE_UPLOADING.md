# Picture Uploading with Vercel Blob — Step-by-Step Tutorial

> **What we did in lessons `12-vercel_blob` and `13-upload_images`:** added the
> ability to attach an image to a wiki article — upload it to the cloud
> (Vercel Blob), store the returned URL in the database, and render it on the
> article page.
>
> This document is a step-by-step guide you can follow (and teach) to
> reproduce the work. Each step says **why** we did it, **where** the code
> lives, and **what** changed.

---

## Table of Contents

1. [Big picture — the flow](#1-big-picture--the-flow)
2. [Files we touched (the map)](#2-files-we-touched-the-map)
3. [Step 1 — Install the Vercel Blob SDK](#3-step-1--install-the-vercel-blob-sdk)
4. [Step 2 — Configure Next.js to allow remote images](#4-step-2--configure-nextjs-to-allow-remote-images)
5. [Step 3 — Add an `imageUrl` column to the database](#5-step-3--add-an-imageurl-column-to-the-database)
6. [Step 4 — Create the upload server action](#6-step-4--create-the-upload-server-action)
7. [Step 5 — Wire the upload into the editor UI](#7-step-5--wire-the-upload-into-the-editor-ui)
8. [Step 6 — Persist `imageUrl` when creating / updating](#8-step-6--persist-imageurl-when-creating--updating)
9. [Step 7 — Return `imageUrl` from the data layer](#9-step-7--return-imageurl-from-the-data-layer)
10. [Step 8 — Render the image in the article viewer](#10-step-8--render-the-image-in-the-article-viewer)
11. [The complete flow, end to end](#11-the-complete-flow-end-to-end)
12. [How to test it](#12-how-to-test-it)
13. [Common gotchas](#13-common-gotchas)
14. [Things to try on your own](#14-things-to-try-on-your-own)

---

## 1. Big picture — the flow

Before we write any code, understand *where the image goes*.

```
 User picks an image in the editor
        │
        ▼
 ┌─────────────────────┐
 │  Browser (client)    │   components/wiki-editor.tsx
 │  - collects the File │
 └─────────┬───────────┘
           │  FormData
           ▼
 ┌─────────────────────┐
 │  Server Action       │   app/actions/upload.ts
 │  - validates type    │
 │  - validates size    │
 │  - uploads to Blob   │
 └─────────┬───────────┘
           │  put()  →  returns { url }
           ▼
 ┌─────────────────────┐
 │  Vercel Blob (cloud)│   https://*.public.blob.vercel-storage.com/...
 │  stores the file    │
 └─────────┬───────────┘
           │  url string
           ▼
 ┌─────────────────────┐
 │  create/update action│  app/actions/articles.ts
 │  saves url in DB     │
 └─────────┬───────────┘
           │  SELECT (data layer)
           ▼
 ┌─────────────────────┐
 │  Article viewer      │   components/wiki-article-viewer.tsx
 │  <Image src={url}/>  │   renders it
 └─────────────────────┘
```

**Key idea:** the browser never talks to the storage directly. A server action
uploads the file, gets back a **public URL**, and that URL is just a string we
store in the `articles` table (like a title or author). Rendering is then
trivial — it's just an `<img>`.

---

## 2. Files we touched (the map)

| # | File | What it does in this feature |
|---|------|------------------------------|
| 1 | `package.json` | adds `@vercel/blob` dependency |
| 2 | `next.config.ts` | whitelists `*.public.blob.vercel-storage.com` for `next/image` |
| 3 | `src/db/schema.ts` | adds `imageUrl` column to the `articles` table |
| 4 | `drizzle/…` + `drizzle/meta/…` | auto-generated migration SQL + snapshot |
| 5 | `app/actions/upload.ts` | **the upload server action** (validate + `put()`) |
| 6 | `components/wiki-editor.tsx` | file picker UI + calls `uploadFile()` before saving |
| 7 | `app/actions/articles.ts` | create/update actions persist `imageUrl` |
| 8 | `lib/data/articles.ts` | `getArticleById()` selects `imageUrl` |
| 9 | `components/wiki-article-viewer.tsx` | renders `<Image>` from `imageUrl` |
| 10 | `src/db/seed.ts` | seed data now includes images (optional) |

---

## 3. Step 1 — Install the Vercel Blob SDK

**Why:** we need the official client library to talk to Vercel Blob storage.

```bash
bun add @vercel/blob
```

That's the whole step. It updates `package.json` and `bun.lock`.

---

## 4. Step 2 — Configure Next.js to allow remote images

**Why:** Next.js's built-in `<Image>` component is **security-conscious**. By
default it will only optimize images from your own domain. If we try to render
an image from Vercel's blob domain, it throws:

```
Invalid src prop on `next/image`, hostname "...blob.vercel-storage.com" is not configured
```

**Fix** — `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
```

**Teach this:** `remotePatterns` is an allow-list. The `*` wildcard covers all
Vercel Blob subdomains (each blob store gets its own random subdomain). We
could have used plain `<img>` and skipped this, but then we'd lose image
optimization (resizing, WebP conversion, lazy loading).

---

## 5. Step 3 — Add an `imageUrl` column to the database

**Why:** we need somewhere to store the URL string that the upload returns.

In `src/db/schema.ts`, add a column to the `articles` table:

```ts
export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),          // 👈 NEW — optional, nullable
  published: boolean("published").default(false).notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => usersSync.id),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});
```

Then generate + apply the migration:

```bash
bun run db:generate   # drizzle-kit generate → creates SQL in drizzle/
bun run db:migrate    # drizzle-kit migrate  → applies it to Neon
```

**Teach this:** `text("image_url")` with **no `.notNull()`** means "optional".
Not every article has a picture, so the column is nullable. Drizzle
auto-generates the migration — you'll see a new file in `drizzle/` and a new
entry in `drizzle/meta/_journal.json`.

---

## 6. Step 4 — Create the upload server action

**Why:** uploading must happen on the **server** (secret credentials live
there, not in the browser). We create a server action in
`app/actions/upload.ts`.

```ts
"use server";

import { put } from "@vercel/blob";

export type UploadedFile = {
  url: string;
  size: number;
  type: string;
  filename?: string;
};

export async function uploadFile(formData: FormData): Promise<UploadedFile> {
  // 1. Guardrails — validate before uploading
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  const files = formData.getAll("files").filter(Boolean) as File[];
  const file = files[0];

  if (!file) throw new Error("No file provided");
  if (!ALLOWED.includes(file.type)) throw new Error("Invalid file type");
  if (file.size > MAX_FILE_SIZE) throw new Error("File too large");

  // 2. Upload to Vercel Blob
  try {
    const blob = await put(file.name, file, {
      access: "public",        // anyone with the URL can read it
      addRandomSuffix: true,   // avoids filename collisions
    });

    // 3. Return the public URL
    return {
      url: blob.url ?? "",
      size: file.size,
      type: file.type,
      filename: blob.pathname ?? file.name,
    };
  } catch (e) {
    console.error("❌ - vercel blob upload error : ", e);
    throw new Error("Upload Failed");
  }
}
```

**Teach this — the three layers of a good upload action:**

1. **Validate** (no file? wrong type? too big?) — fail fast, before we pay for
   a cloud upload.
2. **Upload** — `put()` handles the multipart transfer to Blob storage.
   `access: "public"` gives us a plain URL to embed in HTML.
   `addRandomSuffix: true` means two users uploading `photo.png` won't
   overwrite each other.
3. **Return a clean shape** — the caller only needs `url`, and a few metadata
   fields.

> **Note:** the stub originally had a `TODO` to switch to Cloudinary. Vercel
> Blob was the chosen solution — this is a teaching moment about choosing
> storage providers.

---

## 7. Step 5 — Wire the upload into the editor UI

**Why:** the user needs a file picker, and we must send the selected file to
the server action *before* saving the article, so the article record can
include the returned URL.

In `components/wiki-editor.tsx` (a **client component** — it uses state):

**a) Track the selected files:**

```tsx
const [files, setFiles] = useState<File[]>([]);

const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
  const selectedFiles = event.target.files;
  if (selectedFiles) {
    setFiles((prev) => [...prev, ...Array.from(selectedFiles)]);
  }
};

const removeFile = (index: number) => {
  setFiles((prev) => prev.filter((_, i) => i !== index));
};
```

**b) The drag-and-drop style picker UI (dashed box):**

```tsx
<Card>
  <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
  <CardContent>
    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
      <Upload className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
      <Label htmlFor="file-upload" className="cursor-pointer text-sm font-medium">
        Click to upload files
      </Label>
      <Input
        id="file-upload"
        type="file"
        multiple
        onChange={handleFileUpload}
        className="sr-only"   // hidden; the Label is the click target
      />
    </div>

    {/* show each chosen file with a remove (X) button */}
    {files.length > 0 && (
      <div className="space-y-2">
        {files.map((file, index) => (
          <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-md">
            <span className="text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              ({(file.size / 1024).toFixed(1)} KB)
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeFile(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    )}
  </CardContent>
</Card>
```

**c) Upload inside `handleSubmit`, before saving the article:**

```tsx
let imageUrl: string | undefined;
if (files.length > 0) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const uploaded = await uploadFile(formData);   // ← server action
  imageUrl = uploaded.url;                        // ← public URL
}

if (isEditing && articleId) {
  await updateArticle(articleId, { title, content, imageUrl });
  // ...
} else {
  const result = await createArticle({ title, content, imageUrl });
  // ...
}
```

**Teach this — the sequence matters:**

```
1. user picks file  →  files state (client only, no upload yet)
2. user clicks Save →  uploadFile() runs first  →  get URL
3. create/update runs  →  saves { title, content, imageUrl } to DB
```

If we saved the article *before* uploading, we'd have an article with no
image. Upload-then-save is the correct order.

---

## 8. Step 6 — Persist `imageUrl` when creating / updating

**Why:** the actions must actually write the URL to the database. Without
this, everything before is pointless.

In `app/actions/articles.ts`, the input types gain `imageUrl`:

```ts
export type CreateArticleInput = {
  title: string;
  content: string;
  imageUrl?: string;
};

export type UpdateArticleInput = {
  title?: string;
  content?: string;
  imageUrl?: string;
};
```

And both actions pass it to Drizzle:

```ts
// createArticle
const inserted = await db
  .insert(articles)
  .values({
    title: data.title,
    content: data.content,
    slug: `${Date.now()}`,
    published: true,
    authorId: user.id,
    imageUrl: data.imageUrl ?? undefined,   // 👈
  })
  .returning({ id: articles.id });

// updateArticle
await db
  .update(articles)
  .set({
    title: data.title,
    content: data.content,
    imageUrl: data.imageUrl ?? undefined,   // 👈
  })
  .where(eq(articles.id, +id));
```

**Teach this:** `?? undefined` means "if no image was uploaded, don't wipe an
existing one / don't store null". Small detail, but it prevents a nasty bug:
editing an article *without* touching the image would delete the old image URL.

---

## 9. Step 7 — Return `imageUrl` from the data layer

**Why:** the viewer needs the URL. Add it to the SELECT in `getArticleById()`:

`lib/data/articles.ts`:

```ts
export async function getArticleById(id: number) {
  const rows = await db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      author: usersSync.name,
      imageUrl: articles.imageUrl,      // 👈 NEW
    })
    .from(articles)
    .where(eq(articles.id, id))
    .leftJoin(usersSync, eq(articles.authorId, usersSync.id))
    .limit(1);

  return rows[0] ?? null;
}
```

---

## 10. Step 8 — Render the image in the article viewer

**Why:** the whole point — show the picture.

In `components/wiki-article-viewer.tsx`:

```tsx
import Image from "next/image";

interface ViewerArticle {
  // ...
  imageUrl?: string | null;   // optional — some articles have no image
}

// Inside the component, before the markdown content:
{article.imageUrl && (
  <div className="mb-8">
    <div className="relative w-full h-64 md:h-80 rounded-lg overflow-hidden">
      <Image
        src={article.imageUrl}
        alt={`Image for ${article.title}`}
        fill
        className="object-cover"
        priority
      />
    </div>
  </div>
)}
```

**Teach this:**
- `{article.imageUrl && ...}` — **conditional rendering**. Only render the
  image block if a URL exists (remember, the column is nullable).
- `fill` + a sized parent container (`relative w-full h-64`) — `next/image`
  fills the box; `object-cover` crops it nicely instead of squishing it.
- `priority` — the hero image loads eagerly (LCP optimization).
- `alt` — always describe the image (accessibility + SEO).

---

## 11. The complete flow, end to end

```
 1. Editor:  user selects photo.png           (client state: files[])
 2. Editor:  user clicks "Save Article"
 3. Editor:  uploadFile(formData)  ──────────▶ Server Action
 4. Action:  validates type + size            ("Invalid file type" if bad)
 5. Action:  put() uploads to Vercel Blob ──▶ returns { url }
 6. Editor:  imageUrl = url
 7. Editor:  createArticle({ title, content, imageUrl })
 8. Action:  insert row (image_url = url) into articles table
 9. Browser: router.push(/wiki/{id})
10. Viewer:  getArticleById() selects image_url
11. Viewer:  <Image src={url} fill object-cover /> renders the picture
```

---

## 12. How to test it

1. `bun dev` and open `http://localhost:3000`.
2. Click **Create** → fill in title + content.
3. In **Attachments**, pick an image (jpg/png/gif/webp, under 10MB).
4. Click **Save Article**.
5. You're redirected to the article page — the image shows above the content.
6. Check the browser network tab: the image request goes to
   `https://<random>.public.blob.vercel-storage.com/...`.
7. (Optional) check your Vercel Blob dashboard — the file is there.

**Negative tests (also worth demonstrating):**
- Try uploading a `.txt` file → "Invalid file type".
- Try uploading a huge file → "File too large".
- Edit an article *without* adding an image → the existing image stays.

---

## 13. Common gotchas

| Gotcha | What happens | Fix |
|--------|-------------|-----|
| Forgot `remotePatterns` | `next/image` throws "hostname is not configured" | add the blob hostname to `next.config.ts` |
| Saving article before uploading | article saved, no image | upload **first**, then save |
| `?? undefined` missing | editing without a new image wipes the old URL | use `data.imageUrl ?? undefined` |
| Uploading from client only | secrets leak, CORS issues | always go through a server action |
| No `addRandomSuffix` | two users uploading `pic.png` collide | keep `addRandomSuffix: true` |
| No size/type validation | junk or huge files in storage (cost!) | validate before `put()` |

---

## 14. Things to try on your own

1. **Multiple images** — currently only the *first* file becomes the article
   image. Extend it to store several URLs (e.g., a gallery).
2. **Delete the blob on article delete** — Vercel Blob has a `del()` function.
   Currently deleting an article leaves the orphan file in storage.
3. **Image preview before saving** — use `URL.createObjectURL(file)` to show a
   thumbnail in the editor before upload.
4. **Drag-and-drop** — the dashed box currently only supports click-to-select.
   Add `onDrop` handling.
5. **Client-side size check** — validate file size in the browser too, so the
   user gets instant feedback instead of waiting for the server round-trip.
6. **Switch providers** — the original stub mentioned Cloudinary. Try swapping
   `@vercel/blob` for another provider and compare the API.
