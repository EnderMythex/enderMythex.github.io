Microsoft Windows [version 10.0.26200.8655]
(c) Microsoft Corporation. Tous droits réservés.

C:\Users\EnderMythex\Documents\solana-release\bin>solana-keygen new
Generating a new keypair

For added security, enter a BIP39 passphrase

NOTE! This passphrase improves security of the recovery seed phrase NOT the
keypair file itself, which is stored as insecure plain text

BIP39 Passphrase (empty for none):


Wrote new keypair to C:\Users\EnderMythex\.config\solana\id.json
===========================================================================
pubkey: 2gZtWEaEnXpg7wUse1DoETQHphuNcXiLicoqGbekywuu
===========================================================================
Save this seed phrase and your BIP39 passphrase to recover your new keypair:
unaware tell twelve tonight bean moon apple box bachelor two response cover
===========================================================================

C:\Users\EnderMythex\Documents\solana-release\bin>solana airdrop 2 2gZtWEaEnXpg7wUse1DoETQHphuNcXiLicoqGbekywuu --url
error: The argument '--url <URL_OR_MONIKER>' requires a value but none was supplied

USAGE:
    solana airdrop <AMOUNT> --config <FILEPATH> --url <URL_OR_MONIKER>

For more information try --help

C:\Users\EnderMythex\Documents\solana-release\bin>solana airdrop 2 2gZtWEaEnXpg7wUse1DoETQHphuNcXiLicoqGbekywuu --url https://api.devnet.solana.com
Requesting airdrop of 2 SOL
Error: airdrop request failed. This can happen when the rate limit is reached.

C:\Users\EnderMythex\Documents\solana-release\bin>spl-token create-token --url https://api.devnet.solana.com
Creating token DrHQY5YSqgeDPjgqNQh6pa5y42r6SFPBGNRhvcvtmkex under program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

Address:  DrHQY5YSqgeDPjgqNQh6pa5y42r6SFPBGNRhvcvtmkex
Decimals:  9

Signature: 2uxCpSV9NmB3bpSy4qFAKEZjfR71Rww48sy67BuCNyK2Zuz9hMdHZfJfCVNbpFmoNcAUhCD3obt5YsBY7Dq2Pdig

