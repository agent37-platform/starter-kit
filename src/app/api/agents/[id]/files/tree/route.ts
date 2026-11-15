import { instanceDriveTree } from "@/lib/drive-tree-server";
import { handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return json(await instanceDriveTree(id), 200);
  } catch (e) {
    return handleError(e);
  }
}
