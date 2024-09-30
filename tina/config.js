import { defineConfig } from "tinacms";

// Your hosting provider likely exposes this as an environment variable
const branch = process.env.HEAD || "master";

export default defineConfig({
  branch,
  clientId: process.env.TINACLIENTID, // Get this from tina.io
  token: process.env.TINATOKEN, // Get this from tina.io
  build: {
    outputFolder: "admin",
    publicFolder: "public",
    basePath: "",
  },
  media: {
    tina: {
      mediaRoot: "",
      publicFolder: "public",
    },
  },
  schema: {
    collections: [
      {
        name: "post",
        label: "Posts",
        path: "src/content/posts",
        defaultItem: () => ({
          title: "New Post",
          layout: "../layouts/PostSingle.astro",
          added: new Date(),
          tags: [],
        }),
        ui: {
          dateFormat: "MMM DD YYYY",
          filename: {
            readonly: false,
            slugify: (values) => {
              return values?.slug?.toLowerCase().replace(/ /g, "-");
            },
          },
        },
        fields: [
          {
            name: "title",
            label: "Title",
            type: "string",
            isTitle: true,
            required: false,
          },
          {
            label: "Description",
            name: "description",
            type: "string",
            required: false,
          },
          {
            label: "Image",
            name: "image",
            type: "image",
            required: false,
          },
          {
            label: "Tags",
            name: "tags",
            type: "string",
            list: true,
          },
          {
            label: "Categories",
            name: "categories",
            type: "string",
            list: true,
          },
          {
            label: "Date",
            name: "date",
            type: "datetime",
            dateFormat: "MMM DD YYYY",
            required: false,
          },
          {
            name: "draft",
            label: "Draft",
            type: "boolean",
            defaultValue: false,
          },
          {
            type: "rich-text",
            name: "body",
            label: "Body",
            isBody: false,
          },
        ],
      },
      {
        name: "page",
        label: "Pages",
        path: "src/content/pages",
        fields: [
          {
            name: "title",
            label: "Title",
            type: "string",
            isTitle: true,
            required: false,
          },
          {
            label: "Image",
            name: "image",
            type: "image",
            required: false,
          },
          {
            label: "Description",
            name: "description",
            type: "string",
            required: false,
          },
          {
            label: "Weight",
            name: "weight",
            type: "number",
            required: false,
          },
          {
            name: "draft",
            label: "Draft",
            type: "boolean",
            defaultValue: false,
          },
          {
            type: "rich-text",
            name: "body",
            label: "Body",
            isBody: true,
          },
        ],
      },
    ],
  },
  search: {
    tina: {
      indexerToken: process.env.TINASEARCH,
      stopwordLanguages: ["eng"],
    },
    indexBatchSize: 50,
    maxSearchIndexFieldLength: 100,
  },
});
