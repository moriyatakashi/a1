; ok.asm
BITS 64
SECTION .text
global _start

_start:
    mov eax, 1          ; syscall: write
    mov edi, 1          ; fd: stdout
    lea rsi, [rel msg]  ; buf: address of "OK\n"
    mov edx, 3          ; count: 3 bytes
    syscall

    mov eax, 60         ; syscall: exit
    xor edi, edi        ; status: 0
    syscall

SECTION .data
msg db 'OK', 10
