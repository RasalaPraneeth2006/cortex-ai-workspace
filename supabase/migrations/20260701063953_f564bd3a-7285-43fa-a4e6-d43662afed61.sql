
-- 1. channels: allow creator to update/delete
CREATE POLICY "channels update own"
ON public.channels FOR UPDATE TO authenticated
USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "channels delete own"
ON public.channels FOR DELETE TO authenticated
USING (auth.uid() = created_by);

-- 2. messages: require channel membership on update
DROP POLICY IF EXISTS "messages update own" ON public.messages;
CREATE POLICY "messages update own"
ON public.messages FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND public.is_channel_member(channel_id, auth.uid()))
WITH CHECK (auth.uid() = user_id AND public.is_channel_member(channel_id, auth.uid()));

-- 3. realtime.messages: restrict `messages:<channel_id>` topic subscriptions to channel members
DROP POLICY IF EXISTS "channel members can read realtime messages topic" ON realtime.messages;
CREATE POLICY "channel members can read realtime messages topic"
ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'messages:%' THEN
      EXISTS (
        SELECT 1 FROM public.channel_members
        WHERE channel_id::text = substring(realtime.topic() from 10)
          AND user_id = (SELECT auth.uid())
      )
    ELSE true
  END
);
