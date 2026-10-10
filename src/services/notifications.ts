import { supabase } from '../config/supabase';
import type { NotificationRecord } from '../types';

const NOTIFICATION_FIELDS = 'id, company_id, recipient_profile_id, type, title, body, entity_type, entity_id, metadata, read_at, created_at' as const;

export const listNotifications = async (): Promise<NotificationRecord[]> => {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_FIELDS)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);
  return data;
};

export const markNotificationRead = async (notificationId: string): Promise<void> => {
  const { error } = await supabase.rpc('mark_notification_read', {
    target_notification_id: notificationId,
  });

  if (error) throw new Error(error.message);
};

export const markAllNotificationsRead = async (): Promise<void> => {
  const { error } = await supabase.rpc('mark_all_notifications_read', {});
  if (error) throw new Error(error.message);
};
