import { dispatch } from "../lib/liffRouter.js";

export const GET = (request: Request): Promise<Response> => dispatch("GET", request);
export const POST = (request: Request): Promise<Response> => dispatch("POST", request);
