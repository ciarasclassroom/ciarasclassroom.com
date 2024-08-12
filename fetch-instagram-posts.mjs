import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const INSTAGRAM_USER_ID = '8453018622';
const INSTAGRAM_QUERY_HASH = '58b6785bea111c67129decbe6a448951';

const fetchInstagramPosts = async () => {
  const response = await axios.get(`https://www.instagram.com/graphql/query/`, {
    params: {
      query_hash: INSTAGRAM_QUERY_HASH,
      variables: JSON.stringify({
        id: INSTAGRAM_USER_ID,
        first: 6
      })
    }
  });

  const posts = response.data.data.user.edge_owner_to_timeline_media.edges.slice(3, 6).map(async (edge, index) => {
    const imageUrl = edge.node.display_url;
    const caption = edge.node.edge_media_to_caption.edges[0]?.node?.text || '';
    const postUrl = `https://www.instagram.com/p/${edge.node.shortcode}/`;

    // Download the image
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageName = `${index + 1}.jpg`;
    const imagePath = path.join('public', 'images', 'instagram', imageName);

    try {
      // Save the image to the specified path
      await fs.writeFile(imagePath, imageResponse.data);
    } catch (error) {
      console.error(`An error occurred while saving the image ${imageName}:`, error);
    }

    return {
      imageUrl: `/images/instagram/${imageName}`,
      caption,
      postUrl
    };
  });

  return Promise.all(posts);
};

const posts = await fetchInstagramPosts();

const jsonString = JSON.stringify(posts, null, 2);

try {
  await fs.writeFile('src/lib/fixtures/instagram_posts.json', jsonString, 'utf-8');
} catch (error) {
  console.error('An error occurred while saving the JSON file:', error);
}
