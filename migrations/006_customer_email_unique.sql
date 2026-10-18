-- CSV imports match customers by email, so an email must identify exactly one customer.
UPDATE customers SET email = lower(trim(email));
CREATE UNIQUE INDEX customers_email ON customers (email);
