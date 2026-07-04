import rss from "@astrojs/rss";
import config from "@/config/config.json";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";

export async function GET(context) {
  const posts = sortByDate(await getSinglePage("posts"));

  return rss({
    title: config.site.title,
    description: config.metadata.meta_description,
    site: context.site ?? config.site.base_url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date ? new Date(post.data.date) : undefined,
      link: `/${post.slug}`,
      categories: [...(post.data.categories ?? []), ...(post.data.tags ?? [])],
    })),
    customData: `<language>en-ie</language>`,
  });
}
