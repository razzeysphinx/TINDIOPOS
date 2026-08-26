-- TINDIO: controlled permanent deletion for unused configuration records.
-- Financial, operational, staff, product, and customer history stays immutable.

begin;

create or replace function public.delete_unused_setup_record(
  target_organization_id uuid,
  target_record_type text,
  target_record_id uuid,
  target_confirmation_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_permission text;
  record_name text;
  record_is_inactive boolean;
  record_is_system boolean;
  actor_employee_id uuid;
begin
  if target_record_type not in (
    'category',
    'custom_role',
    'payment_method',
    'discount',
    'tax_rate',
    'dining_option',
    'ticket_template',
    'modifier_group',
    'supplier'
  ) then
    raise exception 'This record type cannot be permanently deleted.' using errcode = '22023';
  end if;

  required_permission := case target_record_type
    when 'custom_role' then 'roles.manage'
    when 'payment_method' then 'settings.manage'
    when 'supplier' then 'inventory.manage'
    else 'products.manage'
  end;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, required_permission)) then
    raise exception 'You do not have permission to permanently delete this record.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  case target_record_type
    when 'category' then
      select category.name, category.is_archived
      into record_name, record_is_inactive
      from public.categories category
      where category.id = target_record_id
        and category.organization_id = target_organization_id;

    when 'custom_role' then
      select role.name, false, role.is_system
      into record_name, record_is_inactive, record_is_system
      from public.roles role
      where role.id = target_record_id
        and role.organization_id = target_organization_id;

    when 'payment_method' then
      select payment_method.name, not payment_method.is_enabled
      into record_name, record_is_inactive
      from public.payment_methods payment_method
      where payment_method.id = target_record_id
        and payment_method.organization_id = target_organization_id;

    when 'discount' then
      select discount.name, not discount.is_active
      into record_name, record_is_inactive
      from public.discounts discount
      where discount.id = target_record_id
        and discount.organization_id = target_organization_id;

    when 'tax_rate' then
      select tax_rate.name, not tax_rate.is_active
      into record_name, record_is_inactive
      from public.tax_rates tax_rate
      where tax_rate.id = target_record_id
        and tax_rate.organization_id = target_organization_id;

    when 'dining_option' then
      select dining_option.name, not dining_option.is_active
      into record_name, record_is_inactive
      from public.dining_options dining_option
      where dining_option.id = target_record_id
        and dining_option.organization_id = target_organization_id;

    when 'ticket_template' then
      select ticket_template.label, not ticket_template.is_active
      into record_name, record_is_inactive
      from public.ticket_templates ticket_template
      where ticket_template.id = target_record_id
        and ticket_template.organization_id = target_organization_id;

    when 'modifier_group' then
      select modifier_group.name, not modifier_group.is_active
      into record_name, record_is_inactive
      from public.modifier_groups modifier_group
      where modifier_group.id = target_record_id
        and modifier_group.organization_id = target_organization_id;

    when 'supplier' then
      select supplier.name, not supplier.is_active
      into record_name, record_is_inactive
      from public.suppliers supplier
      where supplier.id = target_record_id
        and supplier.organization_id = target_organization_id;
  end case;

  if record_name is null then
    raise exception 'Select a record in this organization.' using errcode = '23503';
  end if;

  if target_record_type = 'custom_role' and record_is_system then
    raise exception 'System roles cannot be permanently deleted.' using errcode = '23514';
  end if;

  if target_record_type <> 'custom_role' and not record_is_inactive then
    raise exception 'Archive or disable this record before permanently deleting it.' using errcode = '23514';
  end if;

  if btrim(coalesce(target_confirmation_name, '')) <> record_name then
    raise exception 'Type the exact record name to confirm permanent deletion.' using errcode = '22023';
  end if;

  case target_record_type
    when 'category' then
      if exists (
        select 1 from public.products product
        where product.organization_id = target_organization_id
          and product.category_id = target_record_id
      ) then
        raise exception 'This category is still assigned to products. Reassign them before deletion.' using errcode = '23514';
      end if;

      if exists (
        select 1 from public.kitchen_station_category_routes route
        where route.organization_id = target_organization_id
          and route.category_id = target_record_id
      ) then
        raise exception 'This category is still assigned to a kitchen station. Remove that route before deletion.' using errcode = '23514';
      end if;

      delete from public.categories
      where id = target_record_id and organization_id = target_organization_id;

    when 'custom_role' then
      if exists (
        select 1 from public.employee_roles employee_role
        where employee_role.organization_id = target_organization_id
          and employee_role.role_id = target_record_id
      ) then
        raise exception 'This role is assigned to employees. Reassign them before deletion.' using errcode = '23514';
      end if;

      if exists (
        select 1 from public.employee_invitations invitation
        where invitation.organization_id = target_organization_id
          and invitation.role_id = target_record_id
      ) then
        raise exception 'This role is still referenced by an employee invitation. Revoke the invitation before deletion.' using errcode = '23514';
      end if;

      delete from public.roles
      where id = target_record_id and organization_id = target_organization_id and not is_system;

    when 'payment_method' then
      if exists (
        select 1 from public.payments payment
        where payment.organization_id = target_organization_id
          and payment.payment_method_id = target_record_id
      ) or exists (
        select 1 from public.refund_payments refund_payment
        where refund_payment.organization_id = target_organization_id
          and refund_payment.payment_method_id = target_record_id
      ) then
        raise exception 'This payment method appears in payment history and can only remain disabled.' using errcode = '23514';
      end if;

      delete from public.store_payment_methods
      where organization_id = target_organization_id and payment_method_id = target_record_id;

      delete from public.payment_methods
      where id = target_record_id and organization_id = target_organization_id;

    when 'discount' then
      if exists (
        select 1 from public.sales sale
        where sale.organization_id = target_organization_id
          and sale.discount_id = target_record_id
      ) then
        raise exception 'This discount appears in sales history and can only remain archived.' using errcode = '23514';
      end if;

      delete from public.discounts
      where id = target_record_id and organization_id = target_organization_id;

    when 'tax_rate' then
      if exists (
        select 1 from public.sales sale
        where sale.organization_id = target_organization_id
          and sale.tax_rate_id = target_record_id
      ) then
        raise exception 'This tax rate appears in sales history and can only remain archived.' using errcode = '23514';
      end if;

      delete from public.tax_rates
      where id = target_record_id and organization_id = target_organization_id;

    when 'dining_option' then
      if exists (
        select 1 from public.sales sale
        where sale.organization_id = target_organization_id
          and sale.dining_option_id = target_record_id
      ) or exists (
        select 1 from public.open_tickets ticket
        where ticket.organization_id = target_organization_id
          and ticket.dining_option_id = target_record_id
      ) then
        raise exception 'This dining option appears in ticket or sales history and can only remain archived.' using errcode = '23514';
      end if;

      if exists (
        select 1 from public.ticket_templates template
        where template.organization_id = target_organization_id
          and template.dining_option_id = target_record_id
      ) then
        raise exception 'This dining option is still used by ticket templates. Update those templates before deletion.' using errcode = '23514';
      end if;

      delete from public.dining_options
      where id = target_record_id and organization_id = target_organization_id;

    when 'ticket_template' then
      delete from public.ticket_templates
      where id = target_record_id and organization_id = target_organization_id;

    when 'modifier_group' then
      if exists (
        select 1 from public.product_modifier_groups assignment
        where assignment.organization_id = target_organization_id
          and assignment.modifier_group_id = target_record_id
      ) then
        raise exception 'This modifier group is still assigned to products. Remove those assignments before deletion.' using errcode = '23514';
      end if;

      delete from public.modifier_options
      where organization_id = target_organization_id and modifier_group_id = target_record_id;

      delete from public.modifier_groups
      where id = target_record_id and organization_id = target_organization_id;

    when 'supplier' then
      if exists (
        select 1 from public.purchase_orders purchase_order
        where purchase_order.organization_id = target_organization_id
          and purchase_order.supplier_id = target_record_id
      ) or exists (
        select 1 from public.supplier_returns supplier_return
        where supplier_return.organization_id = target_organization_id
          and supplier_return.supplier_id = target_record_id
      ) then
        raise exception 'This supplier appears in purchasing history and can only remain inactive.' using errcode = '23514';
      end if;

      delete from public.suppliers
      where id = target_record_id and organization_id = target_organization_id;
  end case;

  perform private.write_audit_log(
    target_organization_id,
    'SETUP_RECORD_DELETED',
    required_permission,
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'record_type', target_record_type,
      'record_id', target_record_id,
      'record_name', record_name
    )
  );

  return record_name;
end;
$$;

revoke execute on function public.delete_unused_setup_record(uuid, text, uuid, text)
from public, anon, service_role;
grant execute on function public.delete_unused_setup_record(uuid, text, uuid, text)
to authenticated;

comment on function public.delete_unused_setup_record(uuid, text, uuid, text)
is 'Permanently deletes an unused, previously archived setup record after tenant, permission, dependency, and typed-name confirmation checks.';

commit;
