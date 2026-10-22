BEGIN;

CREATE TYPE user_role AS ENUM ('CUSTOMER', 'MOVER');
CREATE TYPE social_provider AS ENUM ('GOOGLE', 'KAKAO', 'NAVER');
CREATE TYPE service_type AS ENUM ('SMALL', 'HOME', 'OFFICE');
CREATE TYPE move_request_status AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'EXPIRED');
CREATE TYPE quote_status AS ENUM ('SUBMITTED', 'CONFIRMED', 'NOT_SELECTED');
CREATE TYPE notification_type AS ENUM ('NEW_REQUEST', 'NEW_QUOTE', 'QUOTE_CONFIRMED', 'MOVE_DAY');

CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role           user_role   NOT NULL,
  email          text,
  password_hash  text,       
  name           text,
  phone          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social_accounts (
  id           uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider     social_provider NOT NULL,
  provider_id  text            NOT NULL
);

CREATE TABLE customer_profiles (
  user_id        uuid           PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  image_url      text,
  nickname       text,
  career_years   integer,
  intro          text,
  description    text,
  service_types  service_type[],
  regions        text[],
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE mover_profiles (
  user_id        uuid           PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  image_url      text,
  nickname       text,
  career_years   integer,
  intro          text,
  description    text,
  service_types  service_type[],
  regions        text[],
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE move_requests (
  id             uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid                NOT NULL REFERENCES customer_profiles (user_id) ON DELETE CASCADE,
  move_type      service_type        NOT NULL,
  move_date      date                NOT NULL,
  from_address   text                NOT NULL,
  from_zonecode  text,
  from_region    text                NOT NULL,
  to_address     text                NOT NULL,
  to_zonecode    text,
  to_region      text                NOT NULL,
  status         move_request_status NOT NULL DEFAULT 'PENDING',
  confirmed_at   timestamptz,
  created_at     timestamptz         NOT NULL DEFAULT now(),
  updated_at     timestamptz         NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX move_requests_one_active_per_customer_uq
  ON move_requests (customer_id) WHERE status IN ('PENDING', 'CONFIRMED');

CREATE TABLE designated_requests (
  move_request_id  uuid        NOT NULL REFERENCES move_requests (id) ON DELETE CASCADE,
  mover_id         uuid        NOT NULL REFERENCES mover_profiles (user_id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (move_request_id, mover_id)
);

CREATE TABLE quotes (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  move_request_id  uuid         NOT NULL REFERENCES move_requests (id) ON DELETE CASCADE,
  mover_id         uuid         NOT NULL REFERENCES mover_profiles (user_id) ON DELETE CASCADE,
  price            integer      NOT NULL,
  is_designated    boolean      NOT NULL DEFAULT false,
  status           quote_status NOT NULL DEFAULT 'SUBMITTED',
  confirmed_at     timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quotes_one_confirmed_per_request_uq
  ON quotes (move_request_id) WHERE status = 'CONFIRMED';

CREATE TABLE request_rejections (
  move_request_id  uuid        NOT NULL REFERENCES move_requests (id) ON DELETE CASCADE,
  mover_id         uuid        NOT NULL REFERENCES mover_profiles (user_id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (move_request_id, mover_id)
);

CREATE TABLE reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid        NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  rating      numeric     NOT NULL,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE favorites (
  customer_id  uuid        NOT NULL REFERENCES customer_profiles (user_id) ON DELETE CASCADE,
  mover_id     uuid        NOT NULL REFERENCES mover_profiles (user_id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, mover_id)
);

CREATE TABLE notifications (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type             notification_type NOT NULL,
  message          text              NOT NULL,
  move_request_id  uuid              REFERENCES move_requests (id) ON DELETE CASCADE,
  quote_id         uuid              REFERENCES quotes (id) ON DELETE CASCADE,
  created_at       timestamptz       NOT NULL DEFAULT now()
);

COMMIT;
