begin;

create or replace function public.get_pos_reference_bundle_v2(
  target_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  selected_organization_id uuid;
  selected_employee_id uuid;

  permissions text[] := '{}'::text[];
  effective_store_ids uuid[] := '{}'::uuid[];

  categories_json jsonb := '[]'::jsonb;
  payment_methods_json jsonb := '[]'::jsonb;
  loyalty_program_json jsonb := 'null'::jsonb;
  discounts_json jsonb := '[]'::jsonb;
  tax_rates_json jsonb := '[]'::jsonb;
  dining_options_json jsonb := '[]'::jsonb;
  ticket_templates_json jsonb := '[]'::jsonb;
  payload jsonb := '{}'::jsonb;
begin
  actor_profile_id := private.current_profile_id();

  if actor_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'IDENTITY_UNMAPPED'
    );
  end if;

  if target_organization_id is not null then
    select employee.organization_id
    into selected_organization_id
    from public.employees employee
    where employee.profile_id = actor_profile_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
    limit 1;

    if selected_organization_id is null then
      return jsonb_build_object(
        'ok', false,
        'reason', 'ORGANIZATION_FORBIDDEN'
      );
    end if;
  else
    select employee.organization_id
    into selected_organization_id
    from public.employees employee
    join public.organizations organization
      on organization.id = employee.organization_id
    where employee.profile_id = actor_profile_id
      and employee.status = 'active'
    order by
      case when organization.status = 'active' then 0 else 1 end,
      employee.created_at,
      employee.id
    limit 1;
  end if;

  if selected_organization_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NO_ACTIVE_EMPLOYEE'
    );
  end if;

  select employee.id
  into selected_employee_id
  from public.employees employee
  where employee.profile_id = actor_profile_id
    and employee.organization_id = selected_organization_id
    and employee.status = 'active'
  order by employee.created_at, employee.id
  limit 1;

  if selected_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NO_ACTIVE_EMPLOYEE'
    );
  end if;

  select
    coalesce(
      array_agg(
        distinct role_permission.permission_code
        order by role_permission.permission_code
      ),
      '{}'::text[]
    )
  into permissions
  from public.employee_roles employee_role
  join public.role_permissions role_permission
    on role_permission.organization_id = employee_role.organization_id
    and role_permission.role_id = employee_role.role_id
  where employee_role.organization_id = selected_organization_id
    and employee_role.employee_id = selected_employee_id;

  if not (
    'pos.access' = any(permissions)
    and 'sales.create' = any(permissions)
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'POS_ACCESS_FORBIDDEN'
    );
  end if;

  if 'stores.manage' = any(permissions) then
    select
      coalesce(
        array_agg(store.id order by store.created_at, store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.stores store
    where store.organization_id = selected_organization_id
      and store.is_active;
  else
    select
      coalesce(
        array_agg(distinct store.id order by store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.employee_stores assignment
    join public.stores store
      on store.organization_id = assignment.organization_id
      and store.id = assignment.store_id
      and store.is_active
    where assignment.organization_id = selected_organization_id
      and assignment.employee_id = selected_employee_id;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', category.id,
          'name', category.name,
          'color', category.color
        )
        order by category.sort_order, lower(category.name), category.id
      ),
      '[]'::jsonb
    )
  into categories_json
  from public.categories category
  where category.organization_id = selected_organization_id
    and not category.is_archived;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', payment_method.id,
          'storeId', store_payment_method.store_id,
          'name', payment_method.name,
          'code', payment_method.code,
          'type', payment_method.payment_type,
          'offlinePolicy', payment_method.offline_policy,
          'requiresReference', payment_method.requires_reference,
          'sortOrder', payment_method.sort_order
        )
        order by
          store_payment_method.store_id,
          payment_method.sort_order,
          lower(payment_method.name),
          payment_method.id
      ),
      '[]'::jsonb
    )
  into payment_methods_json
  from public.store_payment_methods store_payment_method
  join public.payment_methods payment_method
    on payment_method.organization_id = store_payment_method.organization_id
    and payment_method.id = store_payment_method.payment_method_id
  where store_payment_method.organization_id = selected_organization_id
    and store_payment_method.store_id = any(effective_store_ids)
    and store_payment_method.is_enabled
    and payment_method.is_enabled
    and not payment_method.is_loyalty_redemption;

  select
    coalesce(
      jsonb_build_object(
        'isEnabled', loyalty_program.is_enabled,
        'earnSpendMinor', loyalty_program.earn_spend_minor,
        'earnPoints', loyalty_program.earn_points,
        'redemptionValueMinor', loyalty_program.redemption_value_minor,
        'minimumRedemptionPoints', loyalty_program.minimum_redemption_points
      ),
      'null'::jsonb
    )
  into loyalty_program_json
  from public.loyalty_programs loyalty_program
  where loyalty_program.organization_id = selected_organization_id;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', discount.id,
          'name', discount.name,
          'discountType', discount.discount_type,
          'percentageBps', discount.percentage_bps,
          'amountMinor', discount.amount_minor
        )
        order by discount.sort_order, lower(discount.name), discount.id
      ),
      '[]'::jsonb
    )
  into discounts_json
  from public.discounts discount
  where discount.organization_id = selected_organization_id
    and discount.is_active;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tax_rate.id,
          'name', tax_rate.name,
          'rateBps', tax_rate.rate_bps,
          'isInclusive', tax_rate.is_inclusive,
          'isDefault', tax_rate.is_default
        )
        order by lower(tax_rate.name), tax_rate.id
      ),
      '[]'::jsonb
    )
  into tax_rates_json
  from public.tax_rates tax_rate
  where tax_rate.organization_id = selected_organization_id
    and tax_rate.is_active;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', dining_option.id,
          'name', dining_option.name,
          'isDefault', dining_option.is_default
        )
        order by
          dining_option.sort_order,
          lower(dining_option.name),
          dining_option.id
      ),
      '[]'::jsonb
    )
  into dining_options_json
  from public.dining_options dining_option
  where dining_option.organization_id = selected_organization_id
    and dining_option.is_active;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ticket_template.id,
          'label', ticket_template.label,
          'note', ticket_template.note,
          'diningOptionId', ticket_template.dining_option_id
        )
        order by
          ticket_template.sort_order,
          lower(ticket_template.label),
          ticket_template.id
      ),
      '[]'::jsonb
    )
  into ticket_templates_json
  from public.ticket_templates ticket_template
  where ticket_template.organization_id = selected_organization_id
    and ticket_template.is_active;

  payload := jsonb_build_object(
    'categories', categories_json,
    'paymentMethods', payment_methods_json,
    'loyaltyProgram', loyalty_program_json,
    'discounts', discounts_json,
    'taxRates', tax_rates_json,
    'diningOptions', dining_options_json,
    'ticketTemplates', ticket_templates_json
  );

  return jsonb_build_object(
    'ok', true,
    'organizationId', selected_organization_id,
    'referenceVersion', md5(payload::text),
    'reference', payload
  );
end;
$$;

revoke all
on function public.get_pos_reference_bundle_v2(uuid)
from public, anon, service_role;

grant execute
on function public.get_pos_reference_bundle_v2(uuid)
to authenticated;

comment on function public.get_pos_reference_bundle_v2(uuid)
is
'POS V2 read-only reference bundle. Resolves provider-neutral identity, active employee membership, POS permissions, and effective store scope server-side. Caller can select only a membership-validated organization.';

notify pgrst, 'reload schema';

commit;
