import { Image, type ImageProps } from "antd";

type CanvasImagePreviewProps = {
    src: string;
    alt?: string;
    onClose: () => void;
    imageRender?: Exclude<NonNullable<ImageProps["preview"]>, boolean>["imageRender"];
};

export function CanvasImagePreview({ src, alt = "图片", onClose, imageRender }: CanvasImagePreviewProps) {
    if (!src) return null;

    return (
        <Image
            src={src}
            alt={alt}
            style={{ display: "none" }}
            preview={{
                open: true,
                movable: true,
                minScale: 0.5,
                maxScale: 12,
                scaleStep: 0.25,
                imageRender,
                onOpenChange: (open) => !open && onClose(),
            }}
        />
    );
}
