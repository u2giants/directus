-- Enforce CRM department ownership.
--
-- Departments are customer-owned records. A department must belong to exactly
-- one retailer/customer, department names are unique under a customer, and any
-- CRM record that selects a department must select the matching customer.

alter table crm_department alter column retailer set not null;

create unique index if not exists crm_department_retailer_name_unique
on crm_department (retailer, lower(trim(name)))
where name is not null;

create or replace function crm_assert_department_belongs_to_retailer(p_table text, p_retailer uuid, p_department uuid)
returns void language plpgsql as $$
declare dept_retailer uuid;
begin
  if p_department is null then
    return;
  end if;

  if p_retailer is null then
    raise exception '% cannot set a department without a customer', p_table;
  end if;

  select retailer into dept_retailer from crm_department where id = p_department;
  if dept_retailer is null then
    raise exception '% selected department does not exist or has no customer', p_table;
  end if;

  if dept_retailer is distinct from p_retailer then
    raise exception '% department must belong to the selected customer', p_table;
  end if;
end;
$$;

create or replace function crm_check_buyer_department_scope()
returns trigger language plpgsql as $$
begin
  perform crm_assert_department_belongs_to_retailer('buyer', new.retailer, new.department);
  return new;
end;
$$;

drop trigger if exists crm_buyer_department_scope on buyer;
create trigger crm_buyer_department_scope
before insert or update of retailer, department on buyer
for each row execute function crm_check_buyer_department_scope();

create or replace function crm_check_opportunity_department_scope()
returns trigger language plpgsql as $$
begin
  perform crm_assert_department_belongs_to_retailer('crm_opportunity', new.retailer, new.department);
  return new;
end;
$$;

drop trigger if exists crm_opportunity_department_scope on crm_opportunity;
create trigger crm_opportunity_department_scope
before insert or update of retailer, department on crm_opportunity
for each row execute function crm_check_opportunity_department_scope();

create or replace function crm_check_email_department_scope()
returns trigger language plpgsql as $$
begin
  perform crm_assert_department_belongs_to_retailer('crm_email_message', new.retailer, new.department);
  return new;
end;
$$;

drop trigger if exists crm_email_department_scope on crm_email_message;
create trigger crm_email_department_scope
before insert or update of retailer, department on crm_email_message
for each row execute function crm_check_email_department_scope();

create or replace function crm_check_meeting_department_scope()
returns trigger language plpgsql as $$
begin
  perform crm_assert_department_belongs_to_retailer('crm_meeting_note', new.retailer, new.department);
  return new;
end;
$$;

drop trigger if exists crm_meeting_department_scope on crm_meeting_note;
create trigger crm_meeting_department_scope
before insert or update of retailer, department on crm_meeting_note
for each row execute function crm_check_meeting_department_scope();

create or replace function crm_check_note_department_scope()
returns trigger language plpgsql as $$
begin
  perform crm_assert_department_belongs_to_retailer('crm_note', new.retailer, new.department);
  return new;
end;
$$;

drop trigger if exists crm_note_department_scope on crm_note;
create trigger crm_note_department_scope
before insert or update of retailer, department on crm_note
for each row execute function crm_check_note_department_scope();

create or replace function crm_check_task_department_scope()
returns trigger language plpgsql as $$
begin
  perform crm_assert_department_belongs_to_retailer('crm_task', new.retailer, new.department);
  return new;
end;
$$;

drop trigger if exists crm_task_department_scope on crm_task;
create trigger crm_task_department_scope
before insert or update of retailer, department on crm_task
for each row execute function crm_check_task_department_scope();
