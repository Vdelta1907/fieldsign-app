// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { uploadPrivateImage, resolvePrivateImages } from '../src/lib/privateUploads';
const image='data:image/png;base64,example';
const hash=createHash('sha256').update(image).digest('hex');
const reference='sfmedia:v1:'+hash;
afterEach(()=>vi.unstubAllGlobals());
test('upload caches only verified references per workspace and retries disabled/failed saves',async()=>{
 const invoke=vi.fn(async()=>({data:{reference:image},error:null}));const client:any={functions:{invoke}};
 expect(await uploadPrivateImage(client,image)).toBe(image);
 invoke.mockResolvedValue({data:{reference},error:null});
 expect(await uploadPrivateImage(client,image)).toBe(reference);
 expect(await uploadPrivateImage(client,image)).toBe(reference);expect(invoke).toHaveBeenCalledTimes(2);
 expect(await uploadPrivateImage({functions:{invoke}} as any,image)).toBe(reference);expect(invoke).toHaveBeenCalledTimes(3);
 invoke.mockResolvedValue({data:{reference:'sfmedia:v1:'+'f'.repeat(64)},error:null});
 await expect(uploadPrivateImage({functions:{invoke}} as any,image)).rejects.toThrow('verification failed');
 invoke.mockResolvedValue({data:null,error:new Error('offline')} as any);
 await expect(uploadPrivateImage({functions:{invoke}} as any,image)).rejects.toThrow('changes remain');
});
test('owner reference reads verify exact bytes and preserve inline/null fields',async()=>{
 const invoke=vi.fn(async()=>({data:{data:[{reference,media:[{field:'contractor_logo',sha256:hash,byteLength:image.length,url:'https://example/image'}]}]},error:null}));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(image)));
 const client:any={functions:{invoke}};
 expect(await resolvePrivateImages(client,[reference,null,'legacy'])).toEqual([image,'','legacy']);
 expect(await resolvePrivateImages(client,[null,'legacy'])).toEqual(['','legacy']);
 expect(invoke).toHaveBeenCalledTimes(1);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('corrupt')));
 await expect(resolvePrivateImages({functions:{invoke}} as any,[reference])).rejects.toThrow();
});
