import { defineCollection, z } from "astro:content";

// Post collection schema
const postsCollection = defineCollection({
  schema: z.object({
    id: z.string().optional(),
    title: z.string(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    date: z.date().optional(),
    image: z.string().optional(),
    categories: z.array(z.string()).default(["others"]),
    tags: z.array(z.string()).default(["others"]),
    draft: z.boolean().optional(),
  }),
});

// Pages collection schema
const pagesCollection = defineCollection({
  schema: z.object({
    id: z.string().optional(),
    title: z.string(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    layout: z.string().optional(),
    draft: z.boolean().optional(),
    weight: z.number().optional(),
    hidden: z.boolean().optional(),
  }),
});

// Export collections
export const collections = {
  posts: postsCollection,
  pages: pagesCollection,
};
