export interface TPost {
  id: string;
  slug: string;
  body: string;
  collection: string;
  data: {
    title: string;
    description: string;
    date: any;
    image: string;
    authors: string[];
    categories: string[];
    tags: string[];
    draft: boolean;
  };
  render: () => Promise<{ Content: any }>;
}

export interface TProduct {
  slug: string;
  body: string;
  data: {
    title: string;
    description: string;
    image: string;
    draft: boolean;
  };
  render: () => Promise<{ Content: any }>;
}
