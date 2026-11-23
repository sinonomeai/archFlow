import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiResponseSchema,
  ERROR_CODES,
  type FieldError,
} from "@arch-flow/shared";

export const MOCK_ENABLED =
  process.env.MOCK_API === "1" || process.env.NODE_ENV === "test";

export const mockOk = <T>(
  schema: z.ZodType<T>,
  data: T,
  status = 200,
): NextResponse => {
  const envelope = ApiResponseSchema(schema).parse({
    code: ERROR_CODES.OK,
    message: "success",
    data,
    traceId: crypto.randomUUID(),
  });

  return NextResponse.json(envelope, { status, headers: { "Cache-Control": "no-store" } });
};

export const mockError = (
  status: number,
  code: string,
  message: string,
  errors?: FieldError[],
): NextResponse =>
  NextResponse.json(
    {
      code,
      message,
      data: null,
      errors,
      traceId: crypto.randomUUID(),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export const mockDisabled = (): NextResponse =>
  mockError(
    404,
    ERROR_CODES.BAD_REQUEST,
    "Mock API 未启用（本地 production 预览请设置 MOCK_API=1）",
  );

/** 删除成功：契约规定返回 204 No Content，仅通过响应头暴露 traceId。 */
export const mockNoContent = (): NextResponse =>
  new NextResponse(null, {
    status: 204,
    headers: { "X-Trace-Id": crypto.randomUUID(), "Cache-Control": "no-store" },
  });

export const toFieldErrors = (error: z.ZodError): FieldError[] =>
  error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    code: ERROR_CODES.VALIDATION_FAILED,
    message: issue.message,
  }));
