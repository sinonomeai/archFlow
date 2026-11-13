import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "archflow:isPublic";
export const RAW_RESPONSE_KEY = "archflow:rawResponse";

/** 跳过全局登录守卫（注册、登录、刷新、健康检查）。 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/** 跳过 ApiResponse 包装与 traceId 注入（SSE、204、健康检查）。 */
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
