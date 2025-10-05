a:
	nasm -f elf64 a.asm -o a.o
	od a.o -tx
	ld a.o -o a.out
	./a.out
