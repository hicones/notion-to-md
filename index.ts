import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY!;

const fastify = Fastify();
const supabase = createClient(SUPABASE_URL, SUPABASE_API_KEY);

const NOTION_API_KEY = process.env.NOTION_API_KEY!;
const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

interface ExternalCover {
  type: "external";
  external: { url: string };
}

interface FileCover {
  type: "file";
  file: { url: string };
}

type Cover = ExternalCover | FileCover;

async function saveImageToSupabase(
  imageUrl: string,
  imageName: string
): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();

    const webpBuffer = await sharp(Buffer.from(buffer)).webp().toBuffer();
    const { data, error } = await supabase.storage
      .from("images")
      .upload(`articles/${imageName}.webp`, webpBuffer, {
        contentType: "image/webp",
      });

    if (error) {
      console.error("Erro ao fazer upload da imagem:", error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from("images")
      .getPublicUrl(`articles/${imageName}.webp`);

    return publicUrlData?.publicUrl || null;
  } catch (error) {
    console.error("Erro ao converter ou salvar a imagem:", error);
    return null;
  }
}

fastify.get(
  "/api/:pageId",
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { pageId } = request.params as { pageId: string };

    try {
      const mdBlocks = await n2m.pageToMarkdown(pageId);
      const mdString = n2m.toMarkdownString(mdBlocks);
      const page = (await notion.pages.retrieve({ page_id: pageId })) as any;

      if (
        page.properties &&
        page.properties.Name &&
        page.properties.Name.title
      ) {
        const title = page.properties.Name.title[0].plain_text;
        console.log("Título da página:", title);

        const cover: Cover = page.cover;
        let imageUrl: string | undefined;
        let webpImageUrl: string | null = null;

        if (cover) {
          if (cover.type === "external") {
            imageUrl = cover.external.url;
          } else if (cover.type === "file") {
            imageUrl = cover.file.url;
          }

          if (imageUrl) {
            const imageName = pageId + Math.random().toString(36).substring(7);
            webpImageUrl = await saveImageToSupabase(imageUrl, imageName);
          }
        }

        const { data, error } = await supabase
          .from("articles")
          .insert([{ title, content: mdString.parent, cover: webpImageUrl }]);

        if (error) {
          console.error("Erro ao salvar no Supabase:", error);
          return reply
            .status(500)
            .send({ error: "Erro ao salvar no Supabase" });
        }

        console.log(
          "Markdown e imagem convertida salvos no Supabase com sucesso!"
        );
        return reply.status(200).send({
          success: true,
          message: "Artigo salvo no Supabase com sucesso!",
        });
      } else {
        console.error('A propriedade "Name" não foi encontrada na página.');
        return reply.status(400).send({
          error: 'A propriedade "Name" não foi encontrada na página.',
        });
      }
    } catch (error) {
      console.error("Erro ao processar a página do Notion:", error);
      return reply.status(500).send({ error: "Erro ao processar a página" });
    }
  }
);

fastify.listen({ port: 3000 }, (err: Error | null, address: string) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Servidor rodando em: ${address}`);
});
