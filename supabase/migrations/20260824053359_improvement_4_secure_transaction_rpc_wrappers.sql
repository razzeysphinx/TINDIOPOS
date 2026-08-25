begin;

-- Public RPCs are the intended authenticated boundary. Their private
-- implementations contain the actor, organization, store, and shift checks;
-- running the minimal wrappers as definer lets those checks execute without
-- granting clients direct access to the private routines.
alter function public.open_register_shift(uuid, uuid, uuid, bigint, text) security definer;
alter function public.close_register_shift(uuid, uuid, bigint, text) security definer;
alter function public.record_cash_movement(uuid, uuid, text, bigint, text, uuid, uuid) security definer;
alter function public.get_shift_cash_summary(uuid, uuid) security definer;

alter function public.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb) security definer;
alter function public.cancel_open_ticket(uuid, uuid) security definer;
alter function public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid) security definer;

alter function public.update_shift_cash_close_setting(uuid, boolean) security definer;
alter function public.clock_in_employee(uuid, uuid, text) security definer;
alter function public.clock_out_employee(uuid, text) security definer;
alter function public.get_current_time_clock_entry(uuid) security definer;

revoke execute on function private.open_register_shift(uuid, uuid, uuid, bigint, text) from authenticated;
revoke execute on function private.close_register_shift(uuid, uuid, bigint, text) from authenticated;
revoke execute on function private.record_cash_movement(uuid, uuid, text, bigint, text, uuid) from authenticated;
revoke execute on function private.get_shift_cash_summary(uuid, uuid) from authenticated;
revoke execute on function private.update_shift_cash_close_setting(uuid, boolean) from authenticated;
revoke execute on function private.clock_in_employee(uuid, uuid, text) from authenticated;
revoke execute on function private.clock_out_employee(uuid, text) from authenticated;
revoke execute on function private.get_current_time_clock_entry(uuid) from authenticated;

comment on function public.open_register_shift(uuid, uuid, uuid, bigint, text)
is 'Opens an authorized employee register shift through the secured public POS boundary.';
comment on function public.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb)
is 'Creates or updates a held ticket only for the caller''s active register shift.';
comment on function public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid)
is 'Completes an authorized checkout only for the caller''s active register shift.';
comment on function public.clock_in_employee(uuid, uuid, text)
is 'Starts an authorized attendance entry independently of register-shift state.';

notify pgrst, 'reload schema';

commit;
