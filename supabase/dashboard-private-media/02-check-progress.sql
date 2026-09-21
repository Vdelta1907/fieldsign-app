-- READ ONLY. No order/media contents are returned.
select public.signforth_media_progress() as media_progress;
select
  count(*) as media_references,
  count(distinct object_path) as unique_private_objects,
  coalesce(sum(byte_length),0) as original_referenced_text_bytes,
  (select coalesce(sum(byte_length),0) from (
    select object_path,max(byte_length) byte_length from signforth_private.order_media group by object_path
  ) unique_media) as unique_private_text_bytes
from signforth_private.order_media;
