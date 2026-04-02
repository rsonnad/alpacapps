-- Add Coinbase as a payment method for P2P crypto/USD transfers
BEGIN;

INSERT INTO payment_methods (name, method_type, instructions, display_order, is_active)
VALUES ('Coinbase', 'coinbase', 'Send payment via Coinbase. Include your name in the note.', 5, true)
ON CONFLICT DO NOTHING;

COMMIT;
